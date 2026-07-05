import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const AION_HOST = process.env.AION_HOST ?? "127.0.0.1";
const AION_PORT = process.env.AION_PORT ?? "5000";
const AION_BASE = `http://${AION_HOST}:${AION_PORT}`;

// X-Aion-Service-Token: used by /api/service/chat (no session needed)
const AION_SERVICE_TOKEN = process.env.AION_SERVICE_TOKEN ?? "";

// Cookie value for session-authenticated endpoints (admin, channels, activity)
// Set this to the value of the `aion_token` cookie after logging in.
const AION_SESSION_TOKEN = process.env.AION_SESSION_TOKEN ?? "";

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const aionApiTools: Tool[] = [
  {
    name: "aion_api_chat",
    description:
      "Send a message to Aion via the internal service chat endpoint (/api/service/chat). " +
      "Uses the AION_SERVICE_TOKEN for auth — no user session required. " +
      "Aion responds with full memory context injected.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Message to send to Aion" },
        channel: {
          type: "string",
          description: "Optional channel name to scope context (default: global)",
        },
      },
      required: ["message"],
    },
  },
  {
    name: "aion_channels",
    description:
      "List all Aion chat channels. Requires AION_SESSION_TOKEN to be set.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "aion_channel_history",
    description:
      "Fetch message history for a specific Aion channel. Requires AION_SESSION_TOKEN.",
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Channel name (e.g. 'general')" },
        limit: {
          type: "number",
          description: "Number of messages to return (default: 50)",
        },
      },
      required: ["channel"],
    },
  },
  {
    name: "aion_channel_presence",
    description:
      "Get active users in a specific Aion channel. Requires AION_SESSION_TOKEN.",
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Channel name" },
      },
      required: ["channel"],
    },
  },
  {
    name: "aion_activity",
    description:
      "Get recent audit/activity events from Aion (joins, messages, logins, etc.). " +
      "Requires AION_SESSION_TOKEN.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Number of events to return (default: 50)",
        },
      },
    },
  },
  {
    name: "aion_memory_browse",
    description:
      "Browse Aion's fact memory, optionally filtered by category. " +
      "Requires AION_SESSION_TOKEN. " +
      "Categories: preferences, family, work, hobbies, technical, goals, personal.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Optional category filter",
        },
      },
    },
  },
  {
    name: "aion_admin_users",
    description:
      "List all users registered in Aion. Requires an admin session (AION_SESSION_TOKEN).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "aion_admin_profile_rebuild",
    description:
      "Trigger a rebuild of Aion's cached system prompt profile (re-summarises facts with GPT-4o). " +
      "Requires an admin session (AION_SESSION_TOKEN).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "aion_vast_instances",
    description:
      "List current Vast.ai GPU instances managed by Aion. " +
      "Requires AION_SESSION_TOKEN with vast/admin access.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "aion_vast_offers",
    description:
      "Browse available Vast.ai GPU offers. Requires AION_SESSION_TOKEN with vast/admin access.",
    inputSchema: {
      type: "object",
      properties: {
        max_price: {
          type: "number",
          description: "Max price per hour in USD (optional filter)",
        },
      },
    },
  },
  {
    name: "aion_vast_deploy",
    description:
      "Deploy a new Vast.ai GPU instance via Aion. Requires AION_SESSION_TOKEN with vast/admin access.",
    inputSchema: {
      type: "object",
      properties: {
        offer_id: {
          type: "number",
          description: "Vast.ai offer ID to deploy",
        },
        image: {
          type: "string",
          description: "Docker image to use (optional, uses Aion default if omitted)",
        },
      },
      required: ["offer_id"],
    },
  },
  {
    name: "aion_vast_stop",
    description:
      "Stop a running Vast.ai GPU instance. Requires AION_SESSION_TOKEN with vast/admin access.",
    inputSchema: {
      type: "object",
      properties: {
        instance_id: {
          type: "number",
          description: "Vast.ai instance ID to stop",
        },
      },
      required: ["instance_id"],
    },
  },
  {
    name: "aion_admin_network_run",
    description:
      "Run a network intelligence command (nmap, nikto, etc.) via Aion's admin panel. " +
      "Requires AION_SESSION_TOKEN with admin access.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The network command to execute (e.g. 'nmap -sV 192.168.0.1')",
        },
        target: {
          type: "string",
          description: "Target host/IP/range (optional, may be embedded in command)",
        },
      },
      required: ["command"],
    },
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

function sessionHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (AION_SESSION_TOKEN) {
    headers["Cookie"] = `aion_token=${AION_SESSION_TOKEN}`;
  }
  return headers;
}

async function aionGet(path: string, timeoutMs = 8000): Promise<Response> {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(`${AION_BASE}${path}`, {
    headers: sessionHeaders(),
    signal: ctrl.signal,
  });
}

async function aionPost(
  path: string,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
  timeoutMs = 20000
): Promise<Response> {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(`${AION_BASE}${path}`, {
    method: "POST",
    headers: { ...sessionHeaders(), ...extraHeaders },
    body: JSON.stringify(body),
    signal: ctrl.signal,
  });
}

function noSession(): TextResult {
  return ok({
    error: "AION_SESSION_TOKEN is not set.",
    hint:
      "Log in to Aion at http://127.0.0.1:5000, open DevTools → Application → Cookies, " +
      "copy the `aion_token` value, then set AION_SESSION_TOKEN in your MCP env.",
  });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleAionApiTool(
  name: string,
  args: Record<string, unknown>
): Promise<TextResult> {
  switch (name) {
    // -----------------------------------------------------------------------
    case "aion_api_chat": {
      if (!AION_SERVICE_TOKEN) {
        return ok({
          error: "AION_SERVICE_TOKEN is not set.",
          hint: "Set AION_SERVICE_TOKEN in your MCP environment to the value from Aion's config_local.py service_token.",
        });
      }
      const { message, channel } = args as {
        message: string;
        channel?: string;
      };
      // Omit channel unless explicitly given (Aion's default channel is "global";
      // sending an unknown channel like "general" yields 404). tts:false -> text-only
      // response (no base64 audio blob) which is what an MCP client wants.
      const chatBody: Record<string, unknown> = { message, tts: false };
      if (channel) chatBody.channel = channel;
      try {
        const res = await aionPost(
          "/api/service/chat",
          chatBody,
          { "X-Aion-Service-Token": AION_SERVICE_TOKEN },
          30000
        );
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          return ok({ error: `Aion returned HTTP ${res.status}`, body });
        }
        const data = await res.json();
        return ok({ source: `Aion service chat (${AION_BASE})`, ...data });
      } catch (err) {
        return ok({
          error: `Cannot reach Aion at ${AION_BASE}`,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // -----------------------------------------------------------------------
    case "aion_channels": {
      if (!AION_SESSION_TOKEN) return noSession();
      try {
        const res = await aionGet("/api/channels");
        if (!res.ok) return ok({ error: `HTTP ${res.status}` });
        return ok(await res.json());
      } catch (err) {
        return ok({ error: String(err) });
      }
    }

    // -----------------------------------------------------------------------
    case "aion_channel_history": {
      if (!AION_SESSION_TOKEN) return noSession();
      const { channel, limit = 50 } = args as { channel: string; limit?: number };
      try {
        const res = await aionGet(
          `/api/channels/${encodeURIComponent(channel)}/history?limit=${limit}`
        );
        if (!res.ok) return ok({ error: `HTTP ${res.status}` });
        return ok(await res.json());
      } catch (err) {
        return ok({ error: String(err) });
      }
    }

    // -----------------------------------------------------------------------
    case "aion_channel_presence": {
      if (!AION_SESSION_TOKEN) return noSession();
      const { channel } = args as { channel: string };
      try {
        const res = await aionGet(
          `/api/channels/${encodeURIComponent(channel)}/presence`
        );
        if (!res.ok) return ok({ error: `HTTP ${res.status}` });
        return ok(await res.json());
      } catch (err) {
        return ok({ error: String(err) });
      }
    }

    // -----------------------------------------------------------------------
    case "aion_activity": {
      if (!AION_SESSION_TOKEN) return noSession();
      const { limit = 50 } = args as { limit?: number };
      try {
        const res = await aionGet(`/api/activity?limit=${limit}`);
        if (!res.ok) return ok({ error: `HTTP ${res.status}` });
        return ok(await res.json());
      } catch (err) {
        return ok({ error: String(err) });
      }
    }

    // -----------------------------------------------------------------------
    case "aion_memory_browse": {
      if (!AION_SESSION_TOKEN) return noSession();
      const { category } = args as { category?: string };
      const qs = category ? `?category=${encodeURIComponent(category)}` : "";
      try {
        const res = await aionGet(`/api/memory/browse${qs}`);
        if (!res.ok) return ok({ error: `HTTP ${res.status}` });
        return ok(await res.json());
      } catch (err) {
        return ok({ error: String(err) });
      }
    }

    // -----------------------------------------------------------------------
    case "aion_admin_users": {
      if (!AION_SESSION_TOKEN) return noSession();
      try {
        const res = await aionGet("/api/admin/users");
        if (!res.ok) return ok({ error: `HTTP ${res.status} — need admin session` });
        return ok(await res.json());
      } catch (err) {
        return ok({ error: String(err) });
      }
    }

    // -----------------------------------------------------------------------
    case "aion_admin_profile_rebuild": {
      if (!AION_SESSION_TOKEN) return noSession();
      try {
        const res = await aionPost("/api/admin/profile/rebuild", {}, {}, 60000);
        if (!res.ok) return ok({ error: `HTTP ${res.status} — need admin session` });
        return ok(await res.json());
      } catch (err) {
        return ok({ error: String(err) });
      }
    }

    // -----------------------------------------------------------------------
    case "aion_vast_instances": {
      if (!AION_SESSION_TOKEN) return noSession();
      try {
        const res = await aionGet("/api/admin/vast/instances");
        if (!res.ok) return ok({ error: `HTTP ${res.status}` });
        return ok(await res.json());
      } catch (err) {
        return ok({ error: String(err) });
      }
    }

    // -----------------------------------------------------------------------
    case "aion_vast_offers": {
      if (!AION_SESSION_TOKEN) return noSession();
      const { max_price } = args as { max_price?: number };
      const qs = max_price != null ? `?max_price=${max_price}` : "";
      try {
        const res = await aionGet(`/api/admin/vast/offers${qs}`, 15000);
        if (!res.ok) return ok({ error: `HTTP ${res.status}` });
        return ok(await res.json());
      } catch (err) {
        return ok({ error: String(err) });
      }
    }

    // -----------------------------------------------------------------------
    case "aion_vast_deploy": {
      if (!AION_SESSION_TOKEN) return noSession();
      const { offer_id, image } = args as { offer_id: number; image?: string };
      const body: Record<string, unknown> = { offer_id };
      if (image) body.image = image;
      try {
        const res = await aionPost("/api/admin/vast/deploy", body, {}, 30000);
        if (!res.ok) return ok({ error: `HTTP ${res.status}` });
        return ok(await res.json());
      } catch (err) {
        return ok({ error: String(err) });
      }
    }

    // -----------------------------------------------------------------------
    case "aion_vast_stop": {
      if (!AION_SESSION_TOKEN) return noSession();
      const { instance_id } = args as { instance_id: number };
      try {
        const res = await aionPost(
          `/api/admin/vast/instances/${instance_id}/stop`,
          {},
          {},
          15000
        );
        if (!res.ok) return ok({ error: `HTTP ${res.status}` });
        return ok(await res.json());
      } catch (err) {
        return ok({ error: String(err) });
      }
    }

    // -----------------------------------------------------------------------
    case "aion_admin_network_run": {
      if (!AION_SESSION_TOKEN) return noSession();
      const { command, target } = args as { command: string; target?: string };
      const body: Record<string, unknown> = { command };
      if (target) body.target = target;
      try {
        const res = await aionPost("/api/admin/network/run", body, {}, 60000);
        if (!res.ok) return ok({ error: `HTTP ${res.status}` });
        return ok(await res.json());
      } catch (err) {
        return ok({ error: String(err) });
      }
    }

    // -----------------------------------------------------------------------
    default:
      throw new Error(`Unknown aion-api tool: ${name}`);
  }
}
