/**
 * Fleet MCP Tools — delegate a prompt to another agent CLI (claude / codex / agy)
 * running on any fleet machine (wsl / draydev / ec2), headless.
 *
 * This is the "agent-as-tool" layer: whichever CLI is orchestrating can farm a
 * subtask out to a different model as a normal MCP tool call. Mirrors the SSH
 * shell-out pattern in kali-tools.ts.
 *
 * Auth is provisioned out-of-band (subscription OAuth files already propagated
 * to each box) — these tools assume `claude -p` / `codex exec` / `agy -p` run
 * headless without prompting.
 */
import { exec } from "child_process";
import { promisify } from "util";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Config (env overrides welcome)
// ---------------------------------------------------------------------------
const MAX_CHARS = 8000;
const DEFAULT_TIMEOUT_MS = Number(process.env.FLEET_TIMEOUT_MS ?? 180_000);
const MAX_DEPTH = Number(process.env.FLEET_MAX_DEPTH ?? 2);
const DRAYDEV_HOST = process.env.FLEET_DRAYDEV_HOST ?? process.env.KALI_HOST ?? "192.168.0.200";
const DRAYDEV_USER = process.env.FLEET_DRAYDEV_USER ?? "draygen";
const DRAYDEV_PASS = process.env.FLEET_DRAYDEV_PASS ?? process.env.KALI_PASS ?? "";

// SSH prefix per remote machine. Local machine runs directly (no prefix).
// draydev targets the `draygen` user (holds the propagated auth); ec2 the `ubuntu` user.
const SSH = {
  draydev:
    process.env.FLEET_DRAYDEV_SSH ??
    (DRAYDEV_PASS
      ? `sshpass -p '${DRAYDEV_PASS.replace(/'/g, `'"'"'`)}' ssh -o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no -o ConnectTimeout=10 ${DRAYDEV_USER}@${DRAYDEV_HOST}`
      : ""),
  ec2:
    process.env.FLEET_EC2_SSH ??
    "ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -i " +
      `${process.env.HOME ?? "~"}/.ssh/dst.pem ubuntu@3.238.156.148`,
} as const;

type Machine = "wsl" | "draydev" | "ec2";
type AgentName = "claude" | "codex" | "agy";

// How each agent runs a single headless prompt. `$P` is the decoded prompt,
// `$M` an optional `--model X` fragment (empty if unset).
const AGENT_CMD: Record<AgentName, string> = {
  claude: 'claude -p $M "$P"',
  // codex exec prints a banner + "tokens used" footer to stdout; -o writes ONLY the
  // final message to a file, so we emit that (and fall back to stderr on failure).
  codex:
    'F=$(mktemp); ERR=$(codex exec --skip-git-repo-check $M -o "$F" "$P" 2>&1 >/dev/null); ' +
    'if [ -s "$F" ]; then cat "$F"; else echo "$ERR"; fi; rm -f "$F"',
  agy: 'agy -p $M "$P"',
};

type TextResult = { content: [{ type: "text"; text: string }]; isError?: boolean };
function ok(text: string): TextResult {
  return { content: [{ type: "text", text }] };
}
function fail(text: string): TextResult {
  return { content: [{ type: "text", text }], isError: true };
}

// ---------------------------------------------------------------------------
// Core runner — base64-wraps the remote script so no prompt content can break
// quoting, then executes locally or over SSH under a login shell (`bash -l`)
// so ~/.local/bin (agy) and the CLIs are on PATH.
// ---------------------------------------------------------------------------
async function runAgent(
  machine: Machine,
  agent: AgentName,
  prompt: string,
  opts: { model?: string; cwd?: string; timeoutMs?: number } = {}
): Promise<string> {
  const depth = Number(process.env.FLEET_DEPTH ?? 0);
  if (depth >= MAX_DEPTH) {
    return `[fleet guard] recursion depth ${depth} >= FLEET_MAX_DEPTH ${MAX_DEPTH}; refusing to delegate further.`;
  }
  if (machine !== "wsl" && !SSH[machine as "draydev" | "ec2"]) {
    return `[fleet error ${machine}/${agent}] missing SSH configuration for ${machine}`;
  }

  const promptB64 = Buffer.from(prompt, "utf8").toString("base64");
  const modelFrag = opts.model ? `--model ${opts.model}` : "";
  const cd = opts.cwd ? `cd ${opts.cwd} 2>/dev/null || true; ` : "";

  const script =
    `export FLEET_DEPTH=${depth + 1}; ${cd}` +
    `M='${modelFrag}'; ` +
    `P="$(printf %s '${promptB64}' | base64 -d)"; ` +
    AGENT_CMD[agent];
  const scriptB64 = Buffer.from(script, "utf8").toString("base64");

  const decode = `echo ${scriptB64} | base64 -d | bash -l`;
  const full =
    machine === "wsl" ? decode : `${SSH[machine as "draydev" | "ec2"]} "${decode}"`;

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const { stdout, stderr } = await execAsync(full, { timeout: timeoutMs, maxBuffer: 1 << 24 });
    const out = [stdout, stderr].filter(Boolean).join("\n").trim() || "(no output)";
    return out.length > MAX_CHARS ? out.slice(0, MAX_CHARS) + "\n...(truncated)" : out;
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string; killed?: boolean };
    if (e.killed) return `[fleet timeout after ${timeoutMs}ms on ${machine}/${agent}]`;
    const out = [e.stdout, e.stderr, e.message].filter(Boolean).join("\n").trim();
    return `[fleet error ${machine}/${agent}] ${out.slice(0, 2000)}`;
  }
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
const MACHINES: Machine[] = ["wsl", "draydev", "ec2"];
const AGENTS: AgentName[] = ["claude", "codex", "agy"];

// ---------------------------------------------------------------------------
// Structured status — shared by the fleet_status MCP tool and the read-only
// HTTP fleet gateway (fleet-gateway.ts) so both surfaces run the same probe.
// ---------------------------------------------------------------------------
export type FleetCheck = { agent: AgentName; machine: Machine; ok: boolean; detail: string };

export async function runFleetStatus(
  filter: { machine?: Machine; agent?: AgentName } = {}
): Promise<FleetCheck[]> {
  const machines = filter.machine ? [filter.machine] : MACHINES;
  const agents = filter.agent ? [filter.agent] : AGENTS;
  // Fan out every agent×machine probe in parallel; each is a neutral arithmetic
  // prompt that avoids content-safeguard false negatives from trivial "reply OK".
  const combos = machines.flatMap((m) => agents.map((a) => ({ m, a })));
  return Promise.all(
    combos.map(async ({ m, a }) => {
      const out = await runAgent(m, a, "What is 2+2? Reply with only the number.", {
        timeoutMs: 60_000,
      });
      const ok = /\b4\b/.test(out) && !/^\[fleet (error|timeout|guard)/.test(out);
      return { agent: a, machine: m, ok, detail: out.replace(/\s+/g, " ").slice(0, 120) };
    })
  );
}

export const fleetTools: Tool[] = [
  {
    name: "fleet_run",
    description:
      "Delegate a single prompt to another agent CLI (claude, codex, or agy) running headless " +
      "on a fleet machine (wsl=local, draydev=dev VM, ec2=prod). Returns the agent's response. " +
      "Use to farm a subtask to a different model, or to run work on a remote box. " +
      "codex/agy can edit files and run commands in their sandbox; scope prompts accordingly.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string", enum: AGENTS, description: "Which agent CLI to invoke" },
        machine: {
          type: "string",
          enum: MACHINES,
          description: "Which machine to run on (default draydev — the worker VM)",
        },
        prompt: { type: "string", description: "The prompt/task for the agent" },
        model: { type: "string", description: "Optional model override (agent-specific id)" },
        cwd: { type: "string", description: "Optional working directory on the target machine" },
        timeout_ms: { type: "number", description: "Optional timeout in ms (default 180000)" },
      },
      required: ["agent", "prompt"],
    },
  },
  {
    name: "fleet_review",
    description:
      "Fan out the same prompt (e.g. a diff to review, a design question) to multiple agents in " +
      "parallel and return all responses side by side. Use for consensus code review or to get " +
      "diverse model perspectives before deciding. Defaults to codex + agy (the reliable delegates).",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The task/content to send to every agent" },
        agents: {
          type: "array",
          items: { type: "string", enum: AGENTS },
          description: "Which agents to fan out to (default [codex, agy])",
        },
        machine: {
          type: "string",
          enum: MACHINES,
          description: "Machine to run all agents on (default draydev)",
        },
        timeout_ms: { type: "number", description: "Per-agent timeout in ms (default 180000)" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "fleet_status",
    description:
      "Health-check the fleet: confirm each agent CLI (claude/codex/agy) runs headless & " +
      "authenticated on each machine (wsl/draydev/ec2). Optionally narrow with machine/agent.",
    inputSchema: {
      type: "object",
      properties: {
        machine: { type: "string", enum: MACHINES, description: "Limit to one machine" },
        agent: { type: "string", enum: AGENTS, description: "Limit to one agent" },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export async function handleFleetTool(
  name: string,
  args: Record<string, unknown>
): Promise<TextResult> {
  try {
    if (name === "fleet_run") {
      const agent = String(args.agent ?? "") as AgentName;
      const prompt = String(args.prompt ?? "");
      const machine = (String(args.machine ?? "draydev") || "draydev") as Machine;
      if (!AGENTS.includes(agent)) return fail(`agent must be one of: ${AGENTS.join(", ")}`);
      if (!MACHINES.includes(machine)) return fail(`machine must be one of: ${MACHINES.join(", ")}`);
      if (!prompt) return fail("prompt is required");
      const out = await runAgent(machine, agent, prompt, {
        model: args.model ? String(args.model) : undefined,
        cwd: args.cwd ? String(args.cwd) : undefined,
        timeoutMs: args.timeout_ms ? Number(args.timeout_ms) : undefined,
      });
      return ok(`[${agent}@${machine}]\n${out}`);
    }

    if (name === "fleet_review") {
      const prompt = String(args.prompt ?? "");
      if (!prompt) return fail("prompt is required");
      const machine = (String(args.machine ?? "draydev") || "draydev") as Machine;
      if (!MACHINES.includes(machine)) return fail(`machine must be one of: ${MACHINES.join(", ")}`);
      const requested = Array.isArray(args.agents) ? (args.agents as unknown[]).map(String) : ["codex", "agy"];
      const agents = requested.filter((a): a is AgentName => AGENTS.includes(a as AgentName));
      if (agents.length === 0) return fail(`agents must be a subset of: ${AGENTS.join(", ")}`);
      const timeoutMs = args.timeout_ms ? Number(args.timeout_ms) : undefined;
      const results = await Promise.all(
        agents.map(async (a) => `===== ${a}@${machine} =====\n${await runAgent(machine, a, prompt, { timeoutMs })}`)
      );
      return ok(results.join("\n\n"));
    }

    if (name === "fleet_status") {
      const checks = await runFleetStatus({
        machine: args.machine ? (String(args.machine) as Machine) : undefined,
        agent: args.agent ? (String(args.agent) as AgentName) : undefined,
      });
      const lines = checks.map(
        (c) => `${c.ok ? "✓" : "✗"} ${c.agent}@${c.machine}: ${c.detail.slice(0, 80)}`
      );
      return ok(`[fleet status]\n${lines.join("\n")}`);
    }

    return fail(`Unknown fleet tool: ${name}`);
  } catch (err) {
    return fail(`fleet tool error: ${err instanceof Error ? err.message : String(err)}`);
  }
}
