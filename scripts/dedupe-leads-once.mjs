import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const idx = trimmed.indexOf("=");
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (!key || process.env[key]) return;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
};

// Optional: load .env.local if present (does not overwrite existing env)
loadEnvFile(path.join(__dirname, "..", ".env.local"));

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in your env.");
  console.error("Example: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/dedupe-leads-once.mjs");
  process.exit(1);
}

const DRY_RUN = !["0", "false", "no"].includes(String(process.env.DRY_RUN || "").toLowerCase());
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const normalizeText = (value) => {
  if (!value) return "";
  return value
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
};

const normalizePhone = (value) => {
  if (!value) return "";
  return value.replace(/\D/g, "");
};

const normalizeUrl = (value) => {
  if (!value) return "";
  return value
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "")
    .toLowerCase()
    .trim();
};

const getLeadPhoneSet = (lead) => {
  const phones = [];
  lead.decisors?.forEach((c) => phones.push(normalizePhone(c.phone)));
  lead.attendants?.forEach((c) => phones.push(normalizePhone(c.phone)));
  return new Set(phones.filter(Boolean));
};

const isDuplicateLead = (a, b) => {
  const nameA = normalizeText(a.companyName);
  const nameB = normalizeText(b.companyName);
  if (!nameA || !nameB || nameA !== nameB) return false;

  const phonesA = getLeadPhoneSet(a);
  const phonesB = getLeadPhoneSet(b);
  const phoneMatch = Array.from(phonesA).some((phone) => phonesB.has(phone));

  const siteMatch = normalizeUrl(a.siteUrl) && normalizeUrl(a.siteUrl) === normalizeUrl(b.siteUrl);
  const originMatch = normalizeUrl(a.originLink) && normalizeUrl(a.originLink) === normalizeUrl(b.originLink);

  return phoneMatch || siteMatch || originMatch;
};

const mergeContacts = (current, incoming) => {
  const merged = [];
  const map = new Map();
  const noKey = [];

  const addContact = (contact) => {
    const phoneKey = normalizePhone(contact.phone);
    const nameKey = normalizeText(contact.name);
    const key = phoneKey ? `p:${phoneKey}` : nameKey ? `n:${nameKey}` : "";
    if (!key) {
      noKey.push(contact);
      return;
    }
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...contact });
      return;
    }
    map.set(key, {
      ...existing,
      name: existing.name || contact.name,
      phone: existing.phone || contact.phone,
      role: existing.role || contact.role
    });
  };

  current?.forEach(addContact);
  incoming?.forEach(addContact);

  map.forEach((value) => merged.push(value));
  return [...merged, ...noKey];
};

const dedupeContactList = (contacts) => {
  if (!contacts || contacts.length === 0) return [];
  return mergeContacts(contacts, []);
};

const mergeReferences = (current, incoming) => {
  const merged = [];
  const map = new Map();
  const addRef = (ref) => {
    const linkKey = normalizeUrl(ref.link);
    const key = linkKey || `${ref.platform || ""}:${ref.type || ""}`;
    if (!key) {
      merged.push(ref);
      return;
    }
    if (!map.has(key)) {
      map.set(key, { ...ref });
    }
  };

  current?.forEach(addRef);
  incoming?.forEach(addRef);
  map.forEach((value) => merged.push(value));
  return merged;
};

const mostRecentDate = (a, b) => {
  if (!a) return b || null;
  if (!b) return a || null;
  const timeA = Date.parse(a);
  const timeB = Date.parse(b);
  if (Number.isNaN(timeA) || Number.isNaN(timeB)) return a;
  return timeB > timeA ? b : a;
};

const mergeLeadData = (existing, incoming) => {
  const merged = { ...existing };

  merged.companyName = existing.companyName || incoming.companyName;
  merged.segment = existing.segment || incoming.segment;
  merged.origin = existing.origin || incoming.origin;
  merged.originLink = existing.originLink || incoming.originLink;
  merged.originRating = existing.originRating ?? incoming.originRating;
  merged.siteUrl = existing.siteUrl || incoming.siteUrl;
  merged.siteState = existing.siteState || incoming.siteState;
  merged.sitePainPoints = Array.from(new Set([...(existing.sitePainPoints || []), ...(incoming.sitePainPoints || [])]));
  merged.decisors = mergeContacts(existing.decisors || [], incoming.decisors || []);
  merged.attendants = mergeContacts(existing.attendants || [], incoming.attendants || []);
  merged.references = mergeReferences(existing.references || [], incoming.references || []);
  merged.yearsInBusiness = Math.max(existing.yearsInBusiness || 0, incoming.yearsInBusiness || 0);
  merged.ticketPotential = existing.ticketPotential || incoming.ticketPotential;
  merged.attempts = Math.max(existing.attempts || 0, incoming.attempts || 0);
  merged.lastContactDate = mostRecentDate(existing.lastContactDate, incoming.lastContactDate);
  merged.lastContactPerson = existing.lastContactPerson || incoming.lastContactPerson;
  merged.channelLastAttempt = existing.channelLastAttempt || incoming.channelLastAttempt;
  merged.resultLastAttempt = existing.resultLastAttempt || incoming.resultLastAttempt;
  merged.notes = existing.notes || incoming.notes;
  merged.status = existing.status || incoming.status;
  merged.discardReason = existing.discardReason || incoming.discardReason;
  merged.nextAttemptDate = existing.nextAttemptDate || incoming.nextAttemptDate || null;
  merged.nextAttemptTime = existing.nextAttemptTime || incoming.nextAttemptTime || null;
  merged.nextAttemptChannel = existing.nextAttemptChannel || incoming.nextAttemptChannel || '';
  merged.callbackDate = existing.callbackDate || incoming.callbackDate || null;
  merged.callbackTime = existing.callbackTime || incoming.callbackTime || null;
  merged.callbackRequestedBy = existing.callbackRequestedBy || incoming.callbackRequestedBy;
  merged.meetingDate = existing.meetingDate || incoming.meetingDate || null;
  merged.meetingTime = existing.meetingTime || incoming.meetingTime || null;
  merged.meetingType = existing.meetingType || incoming.meetingType;
  merged.paidValueType = existing.paidValueType || incoming.paidValueType || '';
  merged.paidValueCustom = existing.paidValueCustom ?? incoming.paidValueCustom ?? null;
  merged.needsNextContactOverride = existing.needsNextContactOverride ?? incoming.needsNextContactOverride ?? null;

  return merged;
};

const sanitizeLeadContacts = (lead) => ({
  ...lead,
  decisors: dedupeContactList(lead.decisors || []),
  attendants: dedupeContactList(lead.attendants || [])
});

const stripLeadMeta = (lead) => {
  const { id, updatedAt, deletedAt, _needsSync, ...payload } = lead;
  return payload;
};

const fromRow = (row) => ({
  id: row.id,
  ...(row.payload || {}),
  updatedAt: row.updated_at,
  deletedAt: row.deleted_at ?? null
});

const stableStringify = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
};

const fetchAllLeads = async () => {
  const pageSize = 1000;
  let from = 0;
  let rows = [];
  while (true) {
    const { data, error } = await supabase
      .from("leads")
      .select("id, updated_at, deleted_at, payload, created_at")
      .order("updated_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows = rows.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
};

const getCreatedTime = (row) => {
  const created = row.created_at ? Date.parse(row.created_at) : NaN;
  if (!Number.isNaN(created)) return created;
  return row.updated_at || 0;
};

const run = async () => {
  const rows = await fetchAllLeads();
  const active = rows.filter((row) => row.deleted_at == null);
  const items = active.map((row) => ({ row, lead: fromRow(row) }));

  const used = new Set();
  const groups = [];

  for (let i = 0; i < items.length; i += 1) {
    const seed = items[i];
    if (used.has(seed.row.id)) continue;
    used.add(seed.row.id);
    const group = [seed];
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < items.length; j += 1) {
        const candidate = items[j];
        if (used.has(candidate.row.id)) continue;
        if (group.some((g) => isDuplicateLead(g.lead, candidate.lead))) {
          group.push(candidate);
          used.add(candidate.row.id);
          changed = true;
        }
      }
    }
    if (group.length > 1) groups.push(group);
  }

  if (groups.length === 0) {
    console.log("No duplicate groups found.");
    return;
  }

  const now = Date.now();
  let updateCount = 0;
  let deleteCount = 0;

  for (const group of groups) {
    const sorted = [...group].sort((a, b) => getCreatedTime(a.row) - getCreatedTime(b.row));
    const primary = sorted[0];
    const duplicates = sorted.slice(1);

    let merged = primary.lead;
    duplicates.forEach((item) => {
      merged = mergeLeadData(merged, item.lead);
    });
    merged = sanitizeLeadContacts(merged);
    merged = { ...merged, id: primary.lead.id, updatedAt: now, deletedAt: null };

    const primaryPayload = stableStringify(stripLeadMeta(primary.lead));
    const mergedPayload = stableStringify(stripLeadMeta(merged));
    const shouldUpdate = primaryPayload !== mergedPayload;

    if (DRY_RUN) {
      console.log(`\n[DRY RUN] Group "${primary.lead.companyName}"`);
      console.log(`- keep: ${primary.row.id}`);
      console.log(`- merge: ${duplicates.map((d) => d.row.id).join(", ")}`);
      console.log(`- update primary: ${shouldUpdate ? "yes" : "no"}`);
    } else {
      if (shouldUpdate) {
        const { error: updateError } = await supabase
          .from("leads")
          .update({ updated_at: merged.updatedAt, deleted_at: null, payload: stripLeadMeta(merged) })
          .eq("id", primary.row.id);
        if (updateError) throw updateError;
        updateCount += 1;
      }
      const dupIds = duplicates.map((d) => d.row.id);
      if (dupIds.length > 0) {
        const { error: deleteError } = await supabase
          .from("leads")
          .update({ deleted_at: now, updated_at: now })
          .in("id", dupIds);
        if (deleteError) throw deleteError;
        deleteCount += dupIds.length;
      }
    }
  }

  if (DRY_RUN) {
    console.log(`\n[DRY RUN] Found ${groups.length} duplicate group(s).`);
    console.log("Run again with DRY_RUN=0 to apply.");
  } else {
    console.log(`\nDone. Updated ${updateCount} lead(s), soft-deleted ${deleteCount} duplicate(s).`);
  }
};

run().catch((err) => {
  console.error("Dedupe failed:", err);
  process.exit(1);
});
