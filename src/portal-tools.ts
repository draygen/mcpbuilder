import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const PORTAL_HOST = process.env.PORTAL_HOST ?? "127.0.0.1";
const PORTAL_PORT = process.env.PORTAL_PORT ?? "8888";
const PORTAL_BASE = `http://${PORTAL_HOST}:${PORTAL_PORT}`;

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const portalTools: Tool[] = [
  {
    name: "portal_health",
    description:
      "Check the health of the SyncForge (MFT) portal — the Spring Boot service fronted by Nginx on port 8888. " +
      "Returns status, version, and any reported subsystem health.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "portal_nginx_check",
    description:
      "Check if Nginx is responding on port 8888 (the public gateway for all Drayhub services). " +
      "A quick connectivity probe to the root URL.",
    inputSchema: { type: "object", properties: {} },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type TextResult = { content: { type: "text"; text: string }[] };

function ok(data: unknown): TextResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

async function portalFetch(path: string, timeoutMs = 8000): Promise<Response> {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(`${PORTAL_BASE}${path}`, { signal: ctrl.signal });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handlePortalTool(
  name: string,
  _args: Record<string, unknown>
): Promise<TextResult> {
  switch (name) {
    // -----------------------------------------------------------------------
    case "portal_health": {
      const start = Date.now();
      try {
        const res = await portalFetch("/api/system/public/health");
        const latency_ms = Date.now() - start;
        let details: unknown = null;
        try { details = await res.json(); } catch { /* non-JSON ok */ }
        return ok({
          status: res.ok ? "online" : `http_${res.status}`,
          latency_ms,
          url: `${PORTAL_BASE}/api/system/public/health`,
          details,
        });
      } catch (err) {
        return ok({
          status: "offline",
          latency_ms: Date.now() - start,
          url: `${PORTAL_BASE}/api/system/public/health`,
          detail: err instanceof Error ? err.message : String(err),
          hint: "Start the portal: cd services/portal/mft-server && sudo docker compose up -d",
        });
      }
    }

    // -----------------------------------------------------------------------
    case "portal_nginx_check": {
      const start = Date.now();
      try {
        const res = await portalFetch("/");
        const latency_ms = Date.now() - start;
        return ok({
          status: res.ok || res.status === 302 || res.status === 301 ? "online" : `http_${res.status}`,
          latency_ms,
          http_status: res.status,
          url: PORTAL_BASE,
        });
      } catch (err) {
        return ok({
          status: "offline",
          latency_ms: Date.now() - start,
          url: PORTAL_BASE,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // -----------------------------------------------------------------------
    default:
      throw new Error(`Unknown portal tool: ${name}`);
  }
}
