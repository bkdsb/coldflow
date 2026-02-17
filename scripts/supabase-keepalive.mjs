import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
};

loadEnvFile(path.join(__dirname, "..", ".env.local"));
loadEnvFile(path.join(__dirname, "..", ".env"));

const projectUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const apiKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;
const keepaliveTable = process.env.SUPABASE_KEEPALIVE_TABLE || "leads";
const timeoutMs = Number(process.env.SUPABASE_KEEPALIVE_TIMEOUT_MS || 10000);

if (!projectUrl || !apiKey) {
  console.error("Missing Supabase env for keepalive.");
  console.error("Required: SUPABASE_URL (or VITE_SUPABASE_URL) and an API key.");
  process.exit(1);
}

const baseUrl = projectUrl.replace(/\/+$/, "");
const dbPingUrl = `${baseUrl}/rest/v1/${encodeURIComponent(
  keepaliveTable
)}?select=id&limit=1`;
const authPingUrl = `${baseUrl}/auth/v1/settings`;

const headers = {
  apikey: apiKey,
  Authorization: `Bearer ${apiKey}`,
  Prefer: "return=minimal",
};

const runRequest = async (name, url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    const elapsed = Date.now() - startedAt;
    const body = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      elapsed,
      body,
      name,
      url,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      elapsed: Date.now() - startedAt,
      body: String(error),
      name,
      url,
    };
  } finally {
    clearTimeout(timer);
  }
};

const main = async () => {
  const dbResult = await runRequest("db-query", dbPingUrl);
  if (dbResult.ok) {
    console.log(
      `[keepalive] OK ${dbResult.name} status=${dbResult.status} time=${dbResult.elapsed}ms table=${keepaliveTable}`
    );
    return;
  }

  console.warn(
    `[keepalive] DB ping failed status=${dbResult.status} time=${dbResult.elapsed}ms`
  );
  if (dbResult.body) {
    console.warn(`[keepalive] DB ping response: ${dbResult.body.slice(0, 300)}`);
  }

  const authResult = await runRequest("auth-settings-fallback", authPingUrl);
  if (authResult.ok) {
    console.log(
      `[keepalive] Fallback OK ${authResult.name} status=${authResult.status} time=${authResult.elapsed}ms`
    );
    console.log(
      "[keepalive] Warning: fallback keeps API warm, but DB keepalive is best with service-role key."
    );
    return;
  }

  console.error(
    `[keepalive] FAILED db/status=${dbResult.status} fallback/status=${authResult.status}`
  );
  if (authResult.body) {
    console.error(
      `[keepalive] Fallback response: ${authResult.body.slice(0, 300)}`
    );
  }
  process.exit(1);
};

main().catch((error) => {
  console.error("[keepalive] Unexpected error:", error);
  process.exit(1);
});

