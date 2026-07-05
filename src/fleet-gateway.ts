/**
 * Fleet Gateway — HTTP face over the fleet tools so a web app (AION's /fleet
 * page + chat control hook) can reach them; mcpbuilder itself is stdio-only.
 *
 * Surfaces:
 *   GET  /health                 -> { ok, service, cached, updated_at, write_enabled }
 *   GET  /fleet/status           -> { checks[], updated_at, stale, refreshing }   (read, cached)
 *   POST /fleet/run              -> { ok, output }   (write — runs an agent on a machine)
 *   POST /fleet/review           -> { ok, output }   (write — fans a prompt to agents)
 *
 * Binds 127.0.0.1 by default. Writes are guarded: if FLEET_GATEWAY_TOKEN is set,
 * POSTs must present a matching `x-fleet-token` header; the status probe stays
 * open (read-only). Set FLEET_GATEWAY_WRITE=off to disable writes entirely.
 */
import http from "http";
import { runFleetStatus, handleFleetTool, type FleetCheck } from "./fleet-tools.js";

const PORT = Number(process.env.FLEET_GATEWAY_PORT ?? 5100);
const HOST = process.env.FLEET_GATEWAY_HOST ?? "127.0.0.1";
const TTL_MS = Number(process.env.FLEET_GATEWAY_TTL_MS ?? 120_000);
const TOKEN = process.env.FLEET_GATEWAY_TOKEN ?? "";
const WRITE_ENABLED = (process.env.FLEET_GATEWAY_WRITE ?? "on").toLowerCase() !== "off";
const MAX_BODY = 64 * 1024;

let cache: { checks: FleetCheck[]; updatedAt: string } | null = null;
let refreshing = false;

async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    cache = { checks: await runFleetStatus(), updatedAt: new Date().toISOString() };
  } catch (err) {
    console.error(`[fleet-gateway] refresh failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    refreshing = false;
  }
}

function isStale(): boolean {
  return !cache || Date.now() - new Date(cache.updatedAt).getTime() > TTL_MS;
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY) reject(new Error("body too large"));
    });
    req.on("end", () => {
      if (!raw.trim()) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error("invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function authorizedWrite(req: http.IncomingMessage): boolean {
  if (!WRITE_ENABLED) return false;
  if (!TOKEN) return true; // localhost-only + no token configured
  return req.headers["x-fleet-token"] === TOKEN;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  const path = url.pathname;

  if (req.method === "GET" && path === "/health") {
    send(res, 200, {
      ok: true, service: "fleet-gateway",
      cached: cache !== null, updated_at: cache?.updatedAt ?? null,
      write_enabled: WRITE_ENABLED, token_required: Boolean(TOKEN),
    });
    return;
  }

  if (req.method === "GET" && path === "/fleet/status") {
    const stale = isStale();
    if (stale) void refresh(); // never block on the 60s SSH fan-out
    send(res, 200, { checks: cache?.checks ?? [], updated_at: cache?.updatedAt ?? null, stale, refreshing });
    return;
  }

  if (req.method === "POST" && (path === "/fleet/run" || path === "/fleet/review")) {
    if (!authorizedWrite(req)) {
      send(res, WRITE_ENABLED ? 401 : 403,
        { error: WRITE_ENABLED ? "invalid or missing x-fleet-token" : "writes disabled (FLEET_GATEWAY_WRITE=off)" });
      return;
    }
    let body: Record<string, unknown>;
    try { body = await readBody(req); } catch (e) { send(res, 400, { error: String(e instanceof Error ? e.message : e) }); return; }
    const tool = path === "/fleet/run" ? "fleet_run" : "fleet_review";
    try {
      const result = await handleFleetTool(tool, body);
      const text = result.content?.[0]?.text ?? "";
      send(res, result.isError ? 400 : 200, { ok: !result.isError, output: text });
    } catch (err) {
      send(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  send(res, 404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  console.error(
    `[fleet-gateway] http://${HOST}:${PORT}  (writes ${WRITE_ENABLED ? (TOKEN ? "on, token-required" : "on, localhost") : "off"})`
  );
  void refresh();
});
