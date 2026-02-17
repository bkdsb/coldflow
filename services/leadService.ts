import { Lead, LeadStatus } from "../types";
import { supabase } from "../supabaseClient";
import { ALLOWED_EMAILS } from "../authConfig";

const TABLE_NAME = "leads";
const EVENTS_TABLE = "lead_events";
const STORAGE_KEY = "coldflow_db";
const QUEUE_KEY = "coldflow_queue";
const EVENTS_QUEUE_KEY = "coldflow_events_queue";
const LAST_SYNC_KEY = "coldflow_last_sync";
const LAST_FULL_SYNC_KEY = "coldflow_last_full_sync";
const BACKEND_DISABLED_KEY = "coldflow_backend_disabled";
const MIN_SYNC_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const MORNING_SYNC_HOUR = 6; // Local time hour for daily full sync
const SYNC_POLL_INTERVAL_MS = 2 * 60 * 1000; // Background sync tick

interface QueueItem {
  id: string; // Unique ID for the task
  type: 'SAVE' | 'DELETE';
  payload: Lead | string;
  timestamp: number;
}

interface LeadEventRow {
  lead_id: string;
  event_type: string;
  occurred_at?: string;
  old_status?: string | null;
  new_status?: string | null;
  meta?: Record<string, any> | null;
}

interface EventQueueItem {
  id: string;
  payload: LeadEventRow;
  timestamp: number;
}

type Listener = (leads: Lead[]) => void;

interface LeadRow {
  id: string;
  updated_at: number;
  deleted_at: number | null;
  payload: Record<string, any>;
}

// Helper to generate robust Client IDs (No more temp IDs)
const generateId = () => {
  return 'lead_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
};

const normalizeText = (value: string | null | undefined) => {
  if (!value) return '';
  return value
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
};

const normalizePhone = (value: string | null | undefined) => {
  if (!value) return '';
  return value.replace(/\D/g, '');
};

const normalizeUrl = (value: string | null | undefined) => {
  if (!value) return '';
  return value
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '')
    .toLowerCase()
    .trim();
};

const getLeadPhoneSet = (lead: Lead) => {
  const phones: string[] = [];
  lead.decisors?.forEach((c) => phones.push(normalizePhone(c.phone)));
  lead.attendants?.forEach((c) => phones.push(normalizePhone(c.phone)));
  return new Set(phones.filter(Boolean));
};

const isDuplicateLead = (a: Lead, b: Lead) => {
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

const mergeContacts = (current: Lead['decisors'], incoming: Lead['decisors']) => {
  const merged: Lead['decisors'] = [];
  const map = new Map<string, any>();
  const noKey: Lead['decisors'] = [];

  const addContact = (contact: any) => {
    const phoneKey = normalizePhone(contact.phone);
    const nameKey = normalizeText(contact.name);
    const key = phoneKey ? `p:${phoneKey}` : nameKey ? `n:${nameKey}` : '';
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

const dedupeContactList = (contacts: Lead['decisors']) => {
  if (!contacts || contacts.length === 0) return [];
  return mergeContacts(contacts, []);
};

const mergeReferences = (current: Lead['references'], incoming: Lead['references']) => {
  const merged: Lead['references'] = [];
  const map = new Map<string, any>();
  const addRef = (ref: any) => {
    const linkKey = normalizeUrl(ref.link);
    const key = linkKey || `${ref.platform || ''}:${ref.type || ''}`;
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

const mostRecentDate = (a: string | null | undefined, b: string | null | undefined) => {
  if (!a) return b || null;
  if (!b) return a || null;
  const timeA = Date.parse(a);
  const timeB = Date.parse(b);
  if (Number.isNaN(timeA) || Number.isNaN(timeB)) return a;
  return timeB > timeA ? b : a;
};

const mergeLeadData = (existing: Lead, incoming: Lead, options?: { preferIncomingStatus?: boolean }) => {
  const merged: Lead = { ...existing };
  const preferIncomingStatus = options?.preferIncomingStatus ?? false;

  const preferIncomingText = (current: string | null | undefined, next: string | null | undefined) => {
    if (next === undefined || next === null) return current || '';
    if (typeof next === 'string' && next.trim() === '') return current || '';
    return next;
  };
  const preferIncomingValue = <T>(current: T | null | undefined, next: T | null | undefined) => {
    if (next === undefined || next === null) return current as T;
    return next as T;
  };

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
  merged.lastContactPerson = preferIncomingText(existing.lastContactPerson, incoming.lastContactPerson);
  merged.channelLastAttempt = preferIncomingText(existing.channelLastAttempt, incoming.channelLastAttempt);
  merged.resultLastAttempt = preferIncomingText(existing.resultLastAttempt, incoming.resultLastAttempt);
  merged.notes = preferIncomingText(existing.notes, incoming.notes);
  merged.status = (() => {
    if (!incoming.status) return existing.status;
    if (!preferIncomingStatus && incoming.status === LeadStatus.NOVO && existing.status && existing.status !== LeadStatus.NOVO) {
      return existing.status;
    }
    return incoming.status;
  })();
  merged.discardReason = preferIncomingText(existing.discardReason, incoming.discardReason);
  merged.nextAttemptDate = preferIncomingText(existing.nextAttemptDate, incoming.nextAttemptDate);
  merged.nextAttemptTime = preferIncomingValue(existing.nextAttemptTime ?? null, incoming.nextAttemptTime ?? null);
  merged.nextAttemptChannel = preferIncomingText(existing.nextAttemptChannel, incoming.nextAttemptChannel);
  merged.callbackDate = preferIncomingText(existing.callbackDate, incoming.callbackDate);
  merged.callbackTime = preferIncomingText(existing.callbackTime, incoming.callbackTime);
  merged.callbackRequestedBy = preferIncomingText(existing.callbackRequestedBy, incoming.callbackRequestedBy);
  merged.callbackRequesterName = preferIncomingText(existing.callbackRequesterName, incoming.callbackRequesterName);
  merged.callbackRequesterNameManual = preferIncomingValue(existing.callbackRequesterNameManual ?? null, incoming.callbackRequesterNameManual ?? null);
  merged.meetingDate = preferIncomingText(existing.meetingDate, incoming.meetingDate);
  merged.meetingTime = preferIncomingText(existing.meetingTime, incoming.meetingTime);
  merged.meetingType = preferIncomingText(existing.meetingType, incoming.meetingType);
  merged.paidValueType = preferIncomingText(existing.paidValueType || '', incoming.paidValueType || '') || '';
  merged.paidValueCustom = preferIncomingValue(existing.paidValueCustom ?? null, incoming.paidValueCustom ?? null);
  merged.customScript = preferIncomingValue(existing.customScript ?? null, incoming.customScript ?? null);
  merged.needsNextContactOverride = preferIncomingValue(existing.needsNextContactOverride ?? null, incoming.needsNextContactOverride ?? null) ?? undefined;

  return merged;
};

const sanitizeLeadContacts = (lead: Lead): Lead => {
  return {
    ...lead,
    decisors: dedupeContactList(lead.decisors || []),
    attendants: dedupeContactList(lead.attendants || [])
  };
};

const stripLeadMeta = (lead: Lead) => {
  const { id, updatedAt, deletedAt, _needsSync, ...payload } = lead;
  return payload as Record<string, any>;
};

const buildDuplicateGroups = (leads: Lead[]) => {
  const active = leads.filter((lead) => !lead.deletedAt);
  const used = new Set<string>();
  const groups: Lead[][] = [];

  for (let i = 0; i < active.length; i += 1) {
    const seed = active[i];
    if (used.has(seed.id)) continue;
    const group: Lead[] = [seed];
    used.add(seed.id);
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < active.length; j += 1) {
        const candidate = active[j];
        if (used.has(candidate.id)) continue;
        if (group.some((lead) => isDuplicateLead(lead, candidate))) {
          group.push(candidate);
          used.add(candidate.id);
          changed = true;
        }
      }
    }
    if (group.length > 1) groups.push(group);
  }

  return groups;
};

const toRow = (lead: Lead): LeadRow => ({
  id: lead.id,
  updated_at: lead.updatedAt,
  deleted_at: lead.deletedAt ?? null,
  payload: stripLeadMeta(lead)
});

const fromRow = (row: LeadRow): Lead => ({
  id: row.id,
  ...(row.payload || {}),
  updatedAt: row.updated_at,
  deletedAt: row.deleted_at ?? null
});

class LeadService {
  private leads: Lead[] = [];
  private queue: QueueItem[] = [];
  private eventQueue: EventQueueItem[] = [];
  private listeners: Listener[] = [];
  private isProcessingQueue = false;
  
  // Circuit breaker for backend errors (API not enabled, permission denied)
  private backendDisabled = false;

  constructor() {
    this.loadFromStorage();

    // Bootstrap: if never synced before, queue local leads for upload
    const hasSyncedBefore = !!localStorage.getItem(LAST_SYNC_KEY);
    if (!hasSyncedBefore && this.leads.length > 0 && this.queue.length === 0) {
      const now = Date.now();
      this.leads = this.leads.map(l => ({
        ...l,
        updatedAt: l.updatedAt || now,
        _needsSync: true
      }));
      this.leads.forEach((lead) => {
        this.addToQueue({
          id: `bootstrap_${lead.id}_${now}`,
          type: 'SAVE',
          payload: lead,
          timestamp: now
        });
      });
      this.persistToStorage();
    }
    
    // Check persistent disabled flag
    const disabledFlag = localStorage.getItem(BACKEND_DISABLED_KEY);
    if (disabledFlag === 'true') {
        this.backendDisabled = true;
        // console.log("ColdFlow: Local Mode active (Backend disabled)."); 
    } else {
        // Fetch Remote on init if online and not disabled
        if (navigator.onLine) {
            this.fetchRemote();
        }
    }
    
    // Background Sync Loop (Every 5s)
    setInterval(() => this.processQueue(), 5000); 

    // Background Remote Sync (guarded by MIN_SYNC_INTERVAL_MS)
    setInterval(() => this.fetchRemote(), SYNC_POLL_INTERVAL_MS);
  }

  // --- PUBLIC API ---

  public subscribe(listener: Listener) {
    this.listeners.push(listener);
    // Emit current state immediately so UI renders instantly
    listener(this.leads.filter(l => !l.deletedAt)); 
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  public getLeads(): Lead[] {
    return this.leads.filter(l => !l.deletedAt);
  }

  public getLastSyncTime(): string | null {
    return localStorage.getItem(LAST_SYNC_KEY);
  }

  public isBackendDisabled(): boolean {
    return this.backendDisabled;
  }

  public retryBackend() {
    console.log("ColdFlow: Retrying backend connection...");
    this.backendDisabled = false;
    localStorage.removeItem(BACKEND_DISABLED_KEY);
    this.fetchRemote({ force: true, full: true });
    this.processQueue();
    this.notifyListeners(); // Update UI status
  }

  // --- ACTIONS ---

  public async saveLead(lead: Lead): Promise<void> {
    const now = Date.now();
    
    // 1. Prepare Data
    // Use existing ID or Generate a permanent Client ID immediately.
    const finalId = lead.id || generateId();
    const previousLead = this.leads.find((l) => l.id === finalId) || null;
    
    const leadToSave: Lead = sanitizeLeadContacts({ 
      ...lead, 
      id: finalId,
      updatedAt: now, // Critical for Last-Write-Wins
      deletedAt: null,
      _needsSync: true
    });

    // 2. Dedupe & Merge (avoid duplicate leads)
    const duplicateIndex = this.leads.findIndex(
      (l) => l.id !== finalId && !l.deletedAt && isDuplicateLead(l, leadToSave)
    );

    if (duplicateIndex > -1) {
      const existing = this.leads[duplicateIndex];
      const merged = mergeLeadData(existing, leadToSave, { preferIncomingStatus: true });
      const changed = JSON.stringify(stripLeadMeta(merged)) !== JSON.stringify(stripLeadMeta(existing));

      if (!changed) {
        // Same lead data: ignore newly added
        return;
      }

      const mergedLead: Lead = {
        ...merged,
        id: existing.id,
        updatedAt: now,
        deletedAt: null,
        _needsSync: true
      };

      this.queueLeadEvents(this.createLeadEvents(existing, mergedLead));
      this.leads[duplicateIndex] = mergedLead;
      this.persistToStorage();
      this.notifyListeners();

      this.addToQueue({
        id: `task_${now}_${Math.random()}`,
        type: 'SAVE',
        payload: mergedLead,
        timestamp: now
      });

      this.processQueue();
      return;
    }

    // 3. Optimistic Update (Local Memory)
    const existingIndex = this.leads.findIndex(l => l.id === finalId);
    if (existingIndex > -1) {
      this.leads[existingIndex] = leadToSave;
    } else {
      this.leads.push(leadToSave);
    }

    this.queueLeadEvents(this.createLeadEvents(previousLead, leadToSave));
    
    this.persistToStorage();
    this.notifyListeners(); // UI updates instantly without flicker

    // 4. Queue for Background Sync
    this.addToQueue({
      id: `task_${now}_${Math.random()}`,
      type: 'SAVE',
      payload: leadToSave,
      timestamp: now
    });

    // 5. Try to sync immediately (Fire & Forget)
    this.processQueue();
  }

  public async saveLeadsBatch(incoming: Lead[]): Promise<void> {
    if (!incoming.length) return;
    const now = Date.now();
    let didChange = false;
    const staged: Lead[] = [];
    const queueMap = new Map<string, Lead>();

    const stageLead = (candidate: Lead) => {
      const duplicateIndex = this.leads.findIndex(
        (l) => l.id !== candidate.id && !l.deletedAt && isDuplicateLead(l, candidate)
      );

      if (duplicateIndex > -1) {
        const existing = this.leads[duplicateIndex];
      const merged = sanitizeLeadContacts(mergeLeadData(existing, candidate));
        const changed = JSON.stringify(stripLeadMeta(merged)) !== JSON.stringify(stripLeadMeta(existing));
        if (!changed) {
          return;
        }
        const mergedLead: Lead = {
          ...merged,
          id: existing.id,
          updatedAt: now,
          deletedAt: null,
          _needsSync: true
        };
        this.leads[duplicateIndex] = mergedLead;
        queueMap.set(mergedLead.id, mergedLead);
        didChange = true;
        return;
      }

      const stagedIndex = staged.findIndex((l) => isDuplicateLead(l, candidate));
      if (stagedIndex > -1) {
        const merged = sanitizeLeadContacts(mergeLeadData(staged[stagedIndex], candidate));
        staged[stagedIndex] = {
          ...merged,
          id: staged[stagedIndex].id,
          updatedAt: now,
          deletedAt: null,
          _needsSync: true
        };
        return;
      }

      staged.push(candidate);
    };

    incoming.forEach((lead) => {
      const finalId = lead.id || generateId();
      const leadToSave: Lead = sanitizeLeadContacts({
        ...lead,
        id: finalId,
        updatedAt: now,
        deletedAt: null,
        _needsSync: true
      });
      stageLead(leadToSave);
    });

    staged.forEach((lead) => {
      const existingIndex = this.leads.findIndex((l) => l.id === lead.id);
      if (existingIndex > -1) {
        this.leads[existingIndex] = lead;
      } else {
        this.leads.push(lead);
      }
      queueMap.set(lead.id, lead);
      didChange = true;
    });

    if (!didChange) return;

    this.persistToStorage();
    this.notifyListeners();

    Array.from(queueMap.values()).forEach((lead) => {
      this.addToQueue({
        id: `task_${now}_${Math.random()}`,
        type: 'SAVE',
        payload: lead,
        timestamp: now
      });
    });

    this.processQueue();
  }

  public previewDuplicates() {
    const groups = buildDuplicateGroups(this.leads);
    const duplicateLeads = groups.reduce((sum, group) => sum + (group.length - 1), 0);
    return {
      groups: groups.length,
      duplicates: duplicateLeads,
      total: this.leads.filter((lead) => !lead.deletedAt).length
    };
  }

  public async dedupeDuplicates() {
    const groups = buildDuplicateGroups(this.leads);
    if (groups.length === 0) {
      return { groups: 0, merged: 0, deleted: 0 };
    }

    const now = Date.now();
    let mergedCount = 0;
    let deletedCount = 0;
    let rpcAvailable = false;

    if (supabase && navigator.onLine && !this.backendDisabled) {
      try {
        const { data: authData } = await supabase.auth.getSession();
        const email = authData.session?.user?.email ?? '';
        rpcAvailable = !!authData.session && ALLOWED_EMAILS.includes(email);
      } catch {
        rpcAvailable = false;
      }
    }

    for (const group of groups) {
      const sorted = [...group].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      const primary = sorted[0];
      const duplicates = sorted.slice(1);

      let merged = primary;
      duplicates.forEach((lead) => {
        merged = mergeLeadData(merged, lead);
      });
      merged = sanitizeLeadContacts(merged);

      const mergedLead: Lead = {
        ...merged,
        id: primary.id,
        updatedAt: now,
        deletedAt: null,
        _needsSync: !rpcAvailable
      };

      const primaryPayload = JSON.stringify(stripLeadMeta(primary));
      const mergedPayload = JSON.stringify(stripLeadMeta(mergedLead));
      const shouldUpdate = primaryPayload !== mergedPayload;

      const primaryIndex = this.leads.findIndex((lead) => lead.id === primary.id);
      if (primaryIndex > -1) {
        this.leads[primaryIndex] = mergedLead;
      } else {
        this.leads.push(mergedLead);
      }

      const duplicateIds = duplicates.map((dup) => dup.id);
      let rpcOk = false;

      if (rpcAvailable) {
        try {
          const { error } = await supabase
            .rpc('apply_lead_merge', {
              primary_id: mergedLead.id,
              merged_payload: stripLeadMeta(mergedLead),
              duplicate_ids: duplicateIds
            });
          if (!error) {
            rpcOk = true;
          }
        } catch {
          rpcOk = false;
        }
      }

      if (rpcOk) {
        mergedLead._needsSync = false;
        if (shouldUpdate) mergedCount += 1;
      } else if (shouldUpdate) {
        this.addToQueue({
          id: `task_${now}_${Math.random()}`,
          type: 'SAVE',
          payload: mergedLead,
          timestamp: now
        });
        mergedCount += 1;
      }

      duplicates.forEach((dup) => {
        const idx = this.leads.findIndex((lead) => lead.id === dup.id);
        if (idx > -1) {
          this.leads[idx] = {
            ...this.leads[idx],
            deletedAt: now,
            updatedAt: now,
            _needsSync: !rpcOk
          };
        }
        if (!rpcOk) {
          this.addToQueue({
            id: `task_${now}_${Math.random()}`,
            type: 'DELETE',
            payload: dup.id,
            timestamp: now
          });
        }
        deletedCount += 1;
      });
    }

    this.persistToStorage();
    this.notifyListeners();
    this.processQueue();

    return { groups: groups.length, merged: mergedCount, deleted: deletedCount };
  }

  public async deleteLead(leadId: string): Promise<void> {
    // 1. Optimistic Soft Delete
    const now = Date.now();
    const idx = this.leads.findIndex(l => l.id === leadId);
    if (idx === -1) return;
    this.leads[idx] = {
      ...this.leads[idx],
      deletedAt: now,
      updatedAt: now,
      _needsSync: true
    };
    this.persistToStorage();
    this.notifyListeners();

    // 2. Queue
    this.addToQueue({
      id: `task_${Date.now()}_del`,
      type: 'DELETE',
      payload: leadId,
      timestamp: Date.now()
    });

    this.processQueue();
  }

  // --- INTERNAL ENGINE ---

  private loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      this.leads = stored ? JSON.parse(stored) : [];
      
      const queued = localStorage.getItem(QUEUE_KEY);
      this.queue = queued ? JSON.parse(queued) : [];

      const eventsQueued = localStorage.getItem(EVENTS_QUEUE_KEY);
      this.eventQueue = eventsQueued ? JSON.parse(eventsQueued) : [];
    } catch (e) {
      console.error("Storage Load Error", e);
      this.leads = [];
      this.queue = [];
      this.eventQueue = [];
    }
  }

  private persistToStorage() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.leads));
  }

  private persistQueue() {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(this.queue));
  }

  private persistEventQueue() {
    localStorage.setItem(EVENTS_QUEUE_KEY, JSON.stringify(this.eventQueue));
  }

  private notifyListeners() {
    // Pass only active leads to UI (soft-deleted are hidden)
    const leadsCopy = this.leads.filter(l => !l.deletedAt);
    this.listeners.forEach(l => l(leadsCopy));
  }

  private addToQueue(item: QueueItem) {
    // Optimization: If there is already a pending SAVE for this ID, replace it.
    if (item.type === 'SAVE') {
        const lead = item.payload as Lead;
        this.queue = this.queue.filter(q => !(q.type === 'SAVE' && (q.payload as Lead).id === lead.id));
    }
    this.queue.push(item);
    this.persistQueue();
  }

  private queueLeadEvents(events: LeadEventRow[]) {
    if (!events.length) return;
    const now = Date.now();
    events.forEach((event) => {
      this.eventQueue.push({
        id: `event_${now}_${Math.random()}`,
        payload: event,
        timestamp: now
      });
    });
    this.persistEventQueue();
  }

  private toIsoFromDateTime(date?: string | null, time?: string | null) {
    if (!date) return new Date().toISOString();
    if (date.includes('T')) {
      const parsed = new Date(date);
      return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
    }
    const timePart = time || '12:00';
    const parsed = new Date(`${date}T${timePart}`);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }

  private createLeadEvents(previous: Lead | null, next: Lead): LeadEventRow[] {
    const events: LeadEventRow[] = [];
    if (!previous) {
      return events;
    }

    const parseContactDate = (value?: string | null) => {
      if (!value) return null;
      if (value.includes('T')) {
        const ts = Date.parse(value);
        return Number.isNaN(ts) ? null : ts;
      }
      const [year, month, day] = value.split('-').map(Number);
      if (!year || !month || !day) return null;
      return new Date(year, month - 1, day).getTime();
    };

    if (previous.status !== next.status) {
      events.push({
        lead_id: next.id,
        event_type: 'status_change',
        occurred_at: new Date().toISOString(),
        old_status: previous.status,
        new_status: next.status
      });
    }

    if (previous.lastContactDate !== next.lastContactDate && next.lastContactDate) {
      const prevMs = parseContactDate(previous.lastContactDate);
      const nextMs = parseContactDate(next.lastContactDate);
      if (nextMs && (!prevMs || nextMs > prevMs)) {
        const hasTime = next.lastContactDate.includes('T');
        events.push({
          lead_id: next.id,
          event_type: 'contacted',
          occurred_at: this.toIsoFromDateTime(next.lastContactDate),
          meta: {
            person: next.lastContactPerson || null,
            channel: next.channelLastAttempt || null,
            has_time: hasTime
          }
        });
      }
    }

    if (
      (previous.meetingDate !== next.meetingDate || previous.meetingTime !== next.meetingTime) &&
      next.meetingDate
    ) {
      events.push({
        lead_id: next.id,
        event_type: 'meeting_scheduled',
        occurred_at: this.toIsoFromDateTime(next.meetingDate, next.meetingTime)
      });
    }

    if (
      (previous.callbackDate !== next.callbackDate || previous.callbackTime !== next.callbackTime) &&
      next.callbackDate
    ) {
      events.push({
        lead_id: next.id,
        event_type: 'callback_scheduled',
        occurred_at: this.toIsoFromDateTime(next.callbackDate, next.callbackTime)
      });
    }

    if (
      (previous.nextAttemptDate !== next.nextAttemptDate ||
        previous.nextAttemptTime !== next.nextAttemptTime ||
        previous.nextAttemptChannel !== next.nextAttemptChannel) &&
      next.nextAttemptDate
    ) {
      events.push({
        lead_id: next.id,
        event_type: 'next_attempt_set',
        occurred_at: this.toIsoFromDateTime(next.nextAttemptDate, next.nextAttemptTime),
        meta: {
          channel: next.nextAttemptChannel || null
        }
      });
    }

    if (!previous.needsNextContactOverride && next.needsNextContactOverride) {
      events.push({
        lead_id: next.id,
        event_type: 'next_contact_override',
        occurred_at: new Date().toISOString()
      });
    }

    return events;
  }

  private disableBackend(reason: string) {
      if (this.backendDisabled) return; // Already disabled
      
      console.warn(`ColdFlow: Switching to LOCAL MODE. Reason: ${reason}`);
      console.info("To fix: Verifique o Supabase (RLS/policies) ou a autenticação.");
      
      this.backendDisabled = true;
      localStorage.setItem(BACKEND_DISABLED_KEY, 'true');
      this.notifyListeners(); // Notify UI to update sync status badge
  }

  // --- SYNC LOGIC (The Brain) ---

  private shouldSyncNow(force: boolean) {
    if (force) return true;
    const lastSyncIso = localStorage.getItem(LAST_SYNC_KEY);
    if (!lastSyncIso) return true;
    const lastSyncMs = Date.parse(lastSyncIso);
    if (Number.isNaN(lastSyncMs)) return true;
    return Date.now() - lastSyncMs >= MIN_SYNC_INTERVAL_MS;
  }

  private shouldFullSync(force: boolean) {
    if (force) return true;
    const lastFullIso = localStorage.getItem(LAST_FULL_SYNC_KEY);
    const now = new Date();
    const todayMorning = new Date(now);
    todayMorning.setHours(MORNING_SYNC_HOUR, 0, 0, 0);

    if (!lastFullIso) return now >= todayMorning;
    const lastFullMs = Date.parse(lastFullIso);
    if (Number.isNaN(lastFullMs)) return now >= todayMorning;

    const lastFullDate = new Date(lastFullMs);
    const isSameLocalDay = lastFullDate.toDateString() === now.toDateString();
    return !isSameLocalDay && now >= todayMorning;
  }

  public async fetchRemote(options: { force?: boolean; full?: boolean } = {}) {
    if (!supabase) return;
    if (!navigator.onLine || this.backendDisabled) return;
    const force = options.force === true;
    if (!this.shouldSyncNow(force)) return;

    const { data: authData } = await supabase.auth.getSession();
    const email = authData.session?.user?.email ?? '';
    if (!authData.session || !ALLOWED_EMAILS.includes(email)) return;
    
    try {
      const nowIso = new Date().toISOString();
      const lastSyncIso = localStorage.getItem(LAST_SYNC_KEY);
      const lastSyncMs = lastSyncIso ? Date.parse(lastSyncIso) : 0;
      const doFullSync = options.full === true || !lastSyncMs || Number.isNaN(lastSyncMs) || this.shouldFullSync(force);

      let queryBuilder = supabase.from(TABLE_NAME).select('id, updated_at, deleted_at, payload');
      if (doFullSync) {
        queryBuilder = queryBuilder.order('updated_at', { ascending: true });
      } else {
        queryBuilder = queryBuilder.gt('updated_at', lastSyncMs).order('updated_at', { ascending: true });
      }

      const { data, error } = await queryBuilder;
      if (error) throw error;

      const remoteLeadsMap = new Map<string, Lead>();
      (data || []).forEach((row) => {
          const remoteLead = fromRow(row as LeadRow);
          remoteLeadsMap.set(remoteLead.id, remoteLead);
      });

      let hasChanges = false;
      const mergedLeads = [...this.leads];

      // 1. Process Remote Leads (Incoming)
      remoteLeadsMap.forEach((remoteLead) => {
        const localIndex = mergedLeads.findIndex(l => l.id === remoteLead.id);
        const localLead = mergedLeads[localIndex];

        if (!localLead) {
            // New from server -> Add it
            mergedLeads.push(remoteLead);
            hasChanges = true;
        } else {
            // Conflict Resolution: Last Write Wins
            if (!localLead._needsSync) {
                if ((remoteLead.updatedAt || 0) > (localLead.updatedAt || 0)) {
                    mergedLeads[localIndex] = remoteLead;
                    hasChanges = true;
                }
            }
        }
      });

      let finalLeads = mergedLeads;
      if (doFullSync) {
        // 2. Cleanup: Remove locals that don't exist in remote AND aren't new locally created
        finalLeads = mergedLeads.filter(local => {
            const existsRemote = remoteLeadsMap.has(local.id);
            const isLocallyCreated = local._needsSync; 
            
            if (!existsRemote && !isLocallyCreated) {
                // It was deleted on server. Remove locally.
                hasChanges = true;
                return false;
            }
            return true;
        });
      }

      // 3. Compact: drop already-synced soft-deletes to save storage
      const compactedLeads = finalLeads.filter(local => !local.deletedAt || local._needsSync);
      if (compactedLeads.length !== finalLeads.length) {
        hasChanges = true;
      }
      finalLeads = compactedLeads;

      if (hasChanges) {
          this.leads = finalLeads;
          this.persistToStorage();
          this.notifyListeners();
      }
      
      localStorage.setItem(LAST_SYNC_KEY, nowIso);
      if (doFullSync) {
        localStorage.setItem(LAST_FULL_SYNC_KEY, nowIso);
      }

    } catch (e: any) {
      const status = e?.status;
      if (status === 401 || status === 403) {
        this.disableBackend("Auth inválida ou regras bloqueadas.");
      } else {
        console.warn("Sync: Fetch Remote Failed", e);
      }
    }
  }

  private async processQueue() {
    if (!supabase) return;
    if (this.isProcessingQueue || (!this.queue.length && !this.eventQueue.length) || !navigator.onLine || this.backendDisabled) return;

    const { data: authData } = await supabase.auth.getSession();
    const email = authData.session?.user?.email ?? '';
    if (!authData.session || !ALLOWED_EMAILS.includes(email)) return;

    this.isProcessingQueue = true;

    const cleanupDeletedLead = (leadId: string) => {
      const idx = this.leads.findIndex(l => l.id === leadId);
      if (idx > -1) {
        if (this.leads[idx].deletedAt) {
          this.leads.splice(idx, 1);
        } else {
          this.leads[idx]._needsSync = false;
        }
        this.persistToStorage();
        this.notifyListeners();
      }
    };

    try {
      while (this.queue.length > 0 || this.eventQueue.length > 0) {
        let didWork = false;

        const task = this.queue.length ? this.queue[0] : null;
        if (task) {
          if (task.type === 'DELETE') {
            const leadId = task.payload as string;
            const lead = this.leads.find(l => l.id === leadId);
            const deletedAt = lead?.deletedAt || Date.now();
            const updatedAt = lead?.updatedAt || deletedAt;
            const { error } = await supabase
              .from(TABLE_NAME)
              .update({ updated_at: updatedAt, deleted_at: deletedAt })
              .eq('id', leadId);
            if (error) throw error;
            cleanupDeletedLead(leadId);
          } else if (task.type === 'SAVE') {
            const lead = task.payload as Lead;
            const row = toRow(lead);
            const { error } = await supabase.from(TABLE_NAME).upsert(row, { onConflict: 'id' });
            if (error) throw error;

            const idx = this.leads.findIndex(l => l.id === lead.id);
            if (idx > -1) {
              this.leads[idx]._needsSync = false;
              this.persistToStorage();
            }
          }

          this.queue.shift();
          this.persistQueue();
          didWork = true;
        }

        const eventTask = this.eventQueue.length ? this.eventQueue[0] : null;
        if (eventTask) {
          const { error } = await supabase.from(EVENTS_TABLE).insert(eventTask.payload);
          if (error) throw error;
          this.eventQueue.shift();
          this.persistEventQueue();
          didWork = true;
        }

        if (!didWork) break;
      }
    } catch (e: any) {
      const status = e?.status;
      if (status === 401 || status === 403) {
        this.disableBackend("Auth inválida ou regras bloqueadas.");
      } else {
        console.error("Queue Task Failed", e);
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }
}

export const leadService = new LeadService();
