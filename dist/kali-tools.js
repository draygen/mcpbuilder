/**
 * Kali Linux MCP Tools
 * Runs commands inside kali-custom:latest Docker container on Draydev (192.168.0.200)
 * via SSH, then `docker run --rm --net=host`.
 */
import { exec } from "child_process";
import { promisify } from "util";
const execAsync = promisify(exec);
// ---------------------------------------------------------------------------
// Config (env overrides welcome)
// ---------------------------------------------------------------------------
const KALI_HOST = process.env.KALI_HOST ?? "192.168.0.200";
const KALI_USER = process.env.KALI_USER ?? "draygen";
const KALI_PASS = process.env.KALI_PASS ?? "";
const KALI_IMAGE = process.env.KALI_IMAGE ?? "kali-custom:latest";
const MAX_CHARS = 8000;
const DEFAULT_TIMEOUT_MS = 120_000;
// ---------------------------------------------------------------------------
// SSH execution helper
// ---------------------------------------------------------------------------
async function execInKali(cmd, timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (!KALI_PASS) {
        return "[kali error] KALI_PASS is not configured in the MCP environment.";
    }
    // Build the remote docker run command
    const dockerCmd = `docker run --rm --net=host ${KALI_IMAGE} bash -c '${cmd.replace(/'/g, `'"'"'`)}'`;
    const sshArgs = [
        `sshpass -p '${KALI_PASS}'`,
        `ssh`,
        `-o StrictHostKeyChecking=no`,
        `-o PreferredAuthentications=password`,
        `-o PasswordAuthentication=yes`,
        `-o PubkeyAuthentication=no`,
        `-o ConnectTimeout=10`,
        `${KALI_USER}@${KALI_HOST}`,
        `"${dockerCmd}"`,
    ].join(" ");
    try {
        const { stdout, stderr } = await execAsync(sshArgs, { timeout: timeoutMs });
        const out = [stdout, stderr].filter(Boolean).join("\n").trim() || "(no output)";
        return out.length > MAX_CHARS ? out.slice(0, MAX_CHARS) + "\n...(truncated)" : out;
    }
    catch (err) {
        const e = err;
        const out = [e.stdout, e.stderr, e.message].filter(Boolean).join("\n").trim();
        return `[kali error] ${out.slice(0, 2000)}`;
    }
}
function ok(text) {
    return { content: [{ type: "text", text }] };
}
function fail(text) {
    return { content: [{ type: "text", text }], isError: true };
}
// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
export const kaliTools = [
    {
        name: "kali_nmap",
        description: "Run an nmap scan inside the Kali Docker container on Draydev. Returns port/service info.",
        inputSchema: {
            type: "object",
            properties: {
                target: { type: "string", description: "IP address, hostname, or CIDR range to scan" },
                flags: { type: "string", description: "Extra nmap flags e.g. '-sV -p 1-1024'" },
            },
            required: ["target"],
        },
    },
    {
        name: "kali_exec",
        description: "Run an arbitrary shell command inside the Kali Docker container on Draydev. Use for tools not covered by other kali_* tools.",
        inputSchema: {
            type: "object",
            properties: {
                command: { type: "string", description: "Shell command to run (e.g. 'nikto -h 192.168.0.1')" },
            },
            required: ["command"],
        },
    },
    {
        name: "kali_web_scan",
        description: "Run a Nikto web vulnerability scan against a URL using the Kali container.",
        inputSchema: {
            type: "object",
            properties: {
                url: { type: "string", description: "Target URL (e.g. http://192.168.0.1)" },
            },
            required: ["url"],
        },
    },
    {
        name: "kali_dir_enum",
        description: "Enumerate directories/files on a web server using gobuster with the common wordlist.",
        inputSchema: {
            type: "object",
            properties: {
                url: { type: "string", description: "Target URL (e.g. http://192.168.0.1)" },
                wordlist: {
                    type: "string",
                    description: "Path to wordlist inside Kali container (default: /usr/share/wordlists/dirb/common.txt)",
                },
            },
            required: ["url"],
        },
    },
    {
        name: "kali_whois",
        description: "Run a whois lookup for a domain or IP address via Kali.",
        inputSchema: {
            type: "object",
            properties: {
                target: { type: "string", description: "Domain or IP to look up" },
            },
            required: ["target"],
        },
    },
    {
        name: "kali_status",
        description: "Check that the Kali Docker container can be reached and return the Kali version / tool inventory.",
        inputSchema: {
            type: "object",
            properties: {},
            required: [],
        },
    },
];
// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------
export async function handleKaliTool(name, args) {
    try {
        switch (name) {
            case "kali_nmap": {
                const target = String(args.target ?? "");
                const flags = args.flags ? String(args.flags) : "-sV --open";
                if (!target)
                    return fail("target is required");
                const out = await execInKali(`nmap ${flags} ${target}`);
                return ok(`[nmap ${target}]\n${out}`);
            }
            case "kali_exec": {
                const command = String(args.command ?? "");
                if (!command)
                    return fail("command is required");
                const out = await execInKali(command);
                return ok(`[kali exec: ${command.slice(0, 60)}]\n${out}`);
            }
            case "kali_web_scan": {
                const url = String(args.url ?? "");
                if (!url)
                    return fail("url is required");
                const out = await execInKali(`nikto -h ${url} -maxtime 60`);
                return ok(`[nikto ${url}]\n${out}`);
            }
            case "kali_dir_enum": {
                const url = String(args.url ?? "");
                if (!url)
                    return fail("url is required");
                const wl = args.wordlist
                    ? String(args.wordlist)
                    : "/usr/share/wordlists/dirb/common.txt";
                const out = await execInKali(`gobuster dir -u ${url} -w ${wl} -q --no-progress -t 20`);
                return ok(`[gobuster ${url}]\n${out}`);
            }
            case "kali_whois": {
                const target = String(args.target ?? "");
                if (!target)
                    return fail("target is required");
                const out = await execInKali(`whois ${target}`);
                return ok(`[whois ${target}]\n${out}`);
            }
            case "kali_status": {
                const out = await execInKali(`echo "=== Kali Version ===" && cat /etc/os-release | grep -E "^(NAME|VERSION)" && echo "=== Key Tools ===" && for t in nmap nikto gobuster sqlmap hydra metasploit-framework; do echo -n "$t: "; which $t 2>/dev/null && $t --version 2>&1 | head -1 || echo "not found"; done`);
                return ok(`[kali status @ ${KALI_HOST}]\n${out}`);
            }
            default:
                return fail(`Unknown kali tool: ${name}`);
        }
    }
    catch (err) {
        return fail(`kali tool error: ${err instanceof Error ? err.message : String(err)}`);
    }
}
//# sourceMappingURL=kali-tools.js.map