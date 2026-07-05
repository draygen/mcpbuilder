const SONCHAT_HOST = process.env.SONCHAT_HOST ?? "127.0.0.1";
const SONCHAT_PORT = process.env.SONCHAT_PORT ?? "3000";
const SONCHAT_BASE = `http://${SONCHAT_HOST}:${SONCHAT_PORT}`;
// x-admin-key header value — set SONCHAT_ADMIN_KEY in your MCP env
const SONCHAT_ADMIN_KEY = process.env.SONCHAT_ADMIN_KEY ?? "";
// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
export const sonchatTools = [
    {
        name: "sonchat_health",
        description: "Check if SonChat is online. Returns status and basic service info.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "sonchat_activity",
        description: "Get SonChat activity log — join/leave/message events. Requires SONCHAT_ADMIN_KEY.",
        inputSchema: {
            type: "object",
            properties: {
                limit: {
                    type: "number",
                    description: "Number of events to return (default: 100, max: 500)",
                },
            },
        },
    },
    {
        name: "sonchat_invites",
        description: "List all active invite tokens for SonChat. Requires SONCHAT_ADMIN_KEY.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "sonchat_create_invite",
        description: "Create a new SonChat invite token/link. Requires SONCHAT_ADMIN_KEY.",
        inputSchema: {
            type: "object",
            properties: {
                label: {
                    type: "string",
                    description: "Label for the invite (e.g. 'guest', 'friend') — default: 'guest'",
                },
                expires_in_days: {
                    type: "number",
                    description: "Expiry in days (default: 7)",
                },
                max_uses: {
                    type: "number",
                    description: "Maximum number of uses (optional — unlimited if omitted)",
                },
            },
        },
    },
    {
        name: "sonchat_revoke_invite",
        description: "Revoke/delete a SonChat invite token. Requires SONCHAT_ADMIN_KEY.",
        inputSchema: {
            type: "object",
            properties: {
                token: {
                    type: "string",
                    description: "The invite token to revoke",
                },
            },
            required: ["token"],
        },
    },
];
function ok(data) {
    return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
}
function adminHeaders() {
    return {
        "Content-Type": "application/json",
        "x-admin-key": SONCHAT_ADMIN_KEY,
    };
}
function noAdminKey() {
    return ok({
        error: "SONCHAT_ADMIN_KEY is not set.",
        hint: "Set SONCHAT_ADMIN_KEY in your MCP environment to the SonChat admin key (env var SONCHAT_ADMIN_KEY on the server).",
    });
}
async function sonchatFetch(path, options = {}, timeoutMs = 8000) {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), timeoutMs);
    return fetch(`${SONCHAT_BASE}${path}`, { ...options, signal: ctrl.signal });
}
// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export async function handleSonchatTool(name, args) {
    switch (name) {
        // -----------------------------------------------------------------------
        case "sonchat_health": {
            try {
                const start = Date.now();
                const res = await sonchatFetch("/health");
                const latency_ms = Date.now() - start;
                let details = null;
                try {
                    details = await res.json();
                }
                catch { /* non-JSON ok */ }
                return ok({
                    status: res.ok ? "online" : `http_${res.status}`,
                    latency_ms,
                    url: `${SONCHAT_BASE}/health`,
                    details,
                });
            }
            catch (err) {
                return ok({
                    status: "offline",
                    url: `${SONCHAT_BASE}/health`,
                    detail: err instanceof Error ? err.message : String(err),
                });
            }
        }
        // -----------------------------------------------------------------------
        case "sonchat_activity": {
            if (!SONCHAT_ADMIN_KEY)
                return noAdminKey();
            const { limit = 100 } = args;
            try {
                const res = await sonchatFetch(`/admin/activity?limit=${limit}`, {
                    headers: adminHeaders(),
                });
                if (!res.ok)
                    return ok({ error: `SonChat returned HTTP ${res.status}` });
                return ok(await res.json());
            }
            catch (err) {
                return ok({
                    error: `Cannot reach SonChat at ${SONCHAT_BASE}`,
                    detail: err instanceof Error ? err.message : String(err),
                });
            }
        }
        // -----------------------------------------------------------------------
        case "sonchat_invites": {
            if (!SONCHAT_ADMIN_KEY)
                return noAdminKey();
            try {
                const res = await sonchatFetch("/admin/invites", {
                    headers: adminHeaders(),
                });
                if (!res.ok)
                    return ok({ error: `SonChat returned HTTP ${res.status}` });
                return ok(await res.json());
            }
            catch (err) {
                return ok({
                    error: `Cannot reach SonChat at ${SONCHAT_BASE}`,
                    detail: err instanceof Error ? err.message : String(err),
                });
            }
        }
        // -----------------------------------------------------------------------
        case "sonchat_create_invite": {
            if (!SONCHAT_ADMIN_KEY)
                return noAdminKey();
            const { label = "guest", expires_in_days = 7, max_uses, } = args;
            const body = { label, expiresInDays: expires_in_days };
            if (max_uses != null)
                body.maxUses = max_uses;
            try {
                const res = await sonchatFetch("/admin/invite", {
                    method: "POST",
                    headers: adminHeaders(),
                    body: JSON.stringify(body),
                });
                if (!res.ok) {
                    const text = await res.text().catch(() => "");
                    return ok({ error: `SonChat returned HTTP ${res.status}`, body: text });
                }
                return ok(await res.json());
            }
            catch (err) {
                return ok({
                    error: `Cannot reach SonChat at ${SONCHAT_BASE}`,
                    detail: err instanceof Error ? err.message : String(err),
                });
            }
        }
        // -----------------------------------------------------------------------
        case "sonchat_revoke_invite": {
            if (!SONCHAT_ADMIN_KEY)
                return noAdminKey();
            const { token } = args;
            try {
                const res = await sonchatFetch(`/admin/invite/${encodeURIComponent(token)}`, { method: "DELETE", headers: adminHeaders() });
                if (!res.ok)
                    return ok({ error: `SonChat returned HTTP ${res.status}` });
                let result = { success: true };
                try {
                    result = await res.json();
                }
                catch { /* may return no body */ }
                return ok(result);
            }
            catch (err) {
                return ok({
                    error: `Cannot reach SonChat at ${SONCHAT_BASE}`,
                    detail: err instanceof Error ? err.message : String(err),
                });
            }
        }
        // -----------------------------------------------------------------------
        default:
            throw new Error(`Unknown sonchat tool: ${name}`);
    }
}
//# sourceMappingURL=sonchat-tools.js.map