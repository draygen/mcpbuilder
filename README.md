# aion-mcp (mcpbuilder)

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives an MCP
client (Claude Desktop, Codex, etc.) a single set of tools for driving the **AION**
assistant stack and the surrounding home fleet. It speaks MCP over stdio and is spawned
on demand by the client — there is no long-running daemon to manage.

It is the client half of the [`aion-suite`](../aion-suite) integration: `aion-mcp` calls
`aion-core` (Flask, `127.0.0.1:5000`), which in turn talks to Ollama and Postgres.

```
MCP client (Claude Desktop / Codex)
        │  stdio
        ▼
   aion-mcp  ──HTTP──▶  aion-core (Flask :5000)  ──▶  Ollama (GPU) + Postgres
        │
        └──SSH──▶  fleet machines (draydev / ec2) + Kali container
```

## Tool groups

Tools are organized into modules under `src/`, exposing ~45 tools total:

| Module | Tools | What it does |
|---|---|---|
| `aion-api-tools.ts` | `aion_api_chat`, `aion_channels`, `aion_channel_history`, `aion_channel_presence`, `aion_activity`, `aion_memory_browse`, `aion_admin_*`, `aion_vast_*`, `aion_admin_network_run` | AION Core HTTP API: service chat, channels/presence, activity feed, fact-memory browse, admin, and Vast.ai GPU orchestration |
| `memory-tools.ts` | memory + conversation/profile tools | Read/write AION's SQLite-backed memory and conversation history |
| `chat-tools.ts` | chat/image/model tools | Direct chat, image generation, and model endpoints |
| `sonchat-tools.ts` | `sonchat_*` | Bridge to the sonchat service |
| `portal-tools.ts` | `portal_*` | Portal service endpoints |
| `fleet-tools.ts` | `fleet_status`, `fleet_run`, `fleet_review` | Fan out agent runs across `wsl` / `draydev` / `ec2` over SSH |
| `kali-tools.ts` | `kali_*` | Run security tooling inside a Kali Docker container over SSH |
| `system-tools.ts` | `system_status`, … | Local host/service status |

## Build & run

```bash
npm install
npm run build     # tsc → dist/
npm start         # node dist/index.js  (stdio server)
npm run dev       # tsx src/index.ts     (no build step)
```

The compiled `dist/` is committed so the server runs via `npx`/`node dist/index.js`
without a build step on the client machine.

## Configuration

All host-specific values and secrets come from the **environment** — nothing sensitive is
committed. `.env` and `claude_desktop_config.json` are git-ignored; there are no hardcoded
credential fallbacks (an unset secret disables the affected tool with a clear error rather
than falling back to a real password).

| Variable | Used by | Default | Notes |
|---|---|---|---|
| `AION_HOST` / `AION_PORT` | aion-api | `127.0.0.1` / `5000` | AION Core Flask API |
| `AION_SERVICE_TOKEN` | `aion_api_chat` | — | `X-Aion-Service-Token` for `/api/service/chat`; no user session needed. Required — chat is disabled if unset |
| `AION_SESSION_TOKEN` | session-scoped aion tools | — | Value of the `aion_token` cookie after logging in; required for channels/activity/memory/admin/vast tools |
| `KALI_HOST` / `KALI_USER` / `KALI_PASS` / `KALI_IMAGE` | kali | `192.168.0.200` / `draygen` / — / `kali-custom:latest` | `KALI_PASS` required; kali tools return an error if unset |
| `FLEET_DRAYDEV_HOST` / `FLEET_DRAYDEV_USER` / `FLEET_DRAYDEV_PASS` | fleet | derived / `draygen` / — | draydev SSH; if no password/SSH string is configured the machine is skipped with a clear error |
| `FLEET_EC2_SSH`, `FLEET_TIMEOUT_MS`, `FLEET_MAX_DEPTH` | fleet | — / `180000` / `2` | ec2 SSH string; per-run timeout; recursion guard on delegated fleet runs |

### Claude Desktop

Register the server in `claude_desktop_config.json` (kept local, not committed):

```json
{
  "mcpServers": {
    "aion": {
      "command": "node",
      "args": ["/mnt/c/projects/mcpbuilder/dist/index.js"],
      "env": {
        "AION_SERVICE_TOKEN": "…",
        "AION_SESSION_TOKEN": "…"
      }
    }
  }
}
```

To get `AION_SESSION_TOKEN`: log in to AION at `http://127.0.0.1:5000`, open
DevTools → Application → Cookies, and copy the `aion_token` value.

## Security notes

- No secrets in the repo: `.env` and `claude_desktop_config.json` are ignored and were
  scrubbed from history; committed source has no credential fallbacks.
- `aion_memory_browse` and all session-scoped tools require `AION_SESSION_TOKEN` — they
  do not silently run unauthenticated.
- `kali_*` and `fleet_*` run commands on remote hosts over SSH and are intended for the
  author's own lab/home fleet only.

## Status

Built and tested working end-to-end against a live AION stack — see
[`aion-suite/QA_MCP_AION_FLEET_REPORT.md`](../aion-suite/QA_MCP_AION_FLEET_REPORT.md)
(45 tools registered, service + session endpoints passing, fleet fan-out verified).
