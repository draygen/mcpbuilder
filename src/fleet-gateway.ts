/**
 * Fleet Gateway — a tiny read-only HTTP face over the fleet status probe.
 *
 * mcpbuilder itself is a stdio MCP server, so a web page (e.g. AION's /fleet
 * topology view) can't call it directly. This gateway exposes the SAME
 * `runFleetStatus` probe used by the `fleet_status` MCP tool over localhost
 * HTTP, with a background-refreshed cache so page loads stay fast even though
 * the underlying SSH probes are slow.
 *
 * Read-only by design: it exposes health only, never fleet_run/exec. Binds to
 * 127.0.0.1 unless FLEET_GATEWAY_HOST says otherwise.
 *
 *   GET /health        -> { ok, service, cached, updated_at }
 *   GET /fleet/status  -> { checks[], updated_at, stale, refreshing }
 */
import http from "http";
import { runFleetStatus, type FleetCheck } from "./fleet-tools.js";

const PORT = Number(process.env.FLEET_GATEWAY_PORT ?? 5100);
const HOST = process.env.FLEET_GATEWAY_HOST ?? "127.0.0.1";
const TTL_MS = Number(process.env.FLEET_GATEWAY_TTL_MS ?? 120_000);

let cache: { checks: FleetCheck[]; updatedAt: string } | null = null;
let refreshing = false;

async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const checks = await runFleetStatus();
    cache = { checks, updatedAt: new Date().toISOString() };
  } catch (err) {
    console.error(`[fleet-gateway] refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    // keep the last good cache rather than blanking it
  } finally {
    refreshing = false;
  }
}

function isStale(): boolean {
  if (!cache) return true;
  return Date.now() - new Date(cache.updatedAt).getTime() > TTL_MS;
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);

  if (req.method !== "GET") {
    send(res, 405, { error: "method not allowed" });
    return;
  }

  if (url.pathname === "/health") {
    send(res, 200, {
      ok: true,
      service: "fleet-gateway",
      cached: cache !== null,
      updated_at: cache?.updatedAt ?? null,
    });
    return;
  }

  if (url.pathname === "/fleet/status") {
    const stale = isStale();
    // Fire-and-forget refresh: never block the request on a 60s SSH fan-out.
    if (stale) void refresh();
    send(res, 200, {
      checks: cache?.checks ?? [],
      updated_at: cache?.updatedAt ?? null,
      stale,
      refreshing,
    });
    return;
  }

  send(res, 404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  console.error(`[fleet-gateway] read-only status gateway on http://${HOST}:${PORT}`);
  void refresh();
});
