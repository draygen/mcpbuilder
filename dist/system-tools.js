const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "127.0.0.1";
const OLLAMA_PORT = process.env.OLLAMA_PORT ?? "11434";
const AION_HOST = process.env.AION_HOST ?? "127.0.0.1";
const AION_PORT = process.env.AION_PORT ?? "5000";
const SONCHAT_HOST = process.env.SONCHAT_HOST ?? "127.0.0.1";
const SONCHAT_PORT = process.env.SONCHAT_PORT ?? "3000";
const PORTAL_HOST = process.env.PORTAL_HOST ?? "127.0.0.1";
const PORTAL_PORT = process.env.PORTAL_PORT ?? "8888";
const FOOOCUS_URL = process.env.FOOOCUS_URL ?? "http://127.0.0.1:7865";
// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
export const systemTools = [
    {
        name: "system_status",
        description: "Check the health of all Drayhub services: Ollama (LLM backend), Aion Flask API (port 5000), " +
            "SonChat (port 3000), SyncForge/Portal via Nginx (port 8888), and Fooocus image generation. " +
            "Returns online/offline status and latency for each.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "system_ollama_models",
        description: "List all locally available Ollama models with their sizes. " +
            "Shows which models can be used with AION (AION_MODEL) and Nebula (NEBULA_MODEL).",
        inputSchema: { type: "object", properties: {} },
    },
];
function ok(data) {
    return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
}
async function probe(url, label, timeoutMs = 4000) {
    const start = Date.now();
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        const latency_ms = Date.now() - start;
        let details = null;
        try {
            details = await res.json();
        }
        catch {
            // non-JSON response is fine
        }
        return { label, status: res.ok ? "online" : `http_${res.status}`, latency_ms, details };
    }
    catch {
        return { label, status: "offline", latency_ms: Date.now() - start };
    }
}
// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export async function handleSystemTool(name, _args) {
    switch (name) {
        // -----------------------------------------------------------------------
        case "system_status": {
            const [ollama, aion, sonchat, portal, fooocus] = await Promise.all([
                probe(`http://${OLLAMA_HOST}:${OLLAMA_PORT}/api/tags`, "Ollama"),
                probe(`http://${AION_HOST}:${AION_PORT}/api/health`, "Aion Flask API"),
                probe(`http://${SONCHAT_HOST}:${SONCHAT_PORT}/health`, "SonChat"),
                probe(`http://${PORTAL_HOST}:${PORTAL_PORT}/api/system/public/health`, "SyncForge Portal (Nginx)"),
                probe(`${FOOOCUS_URL}/ping`, "Fooocus Image Gen"),
            ]);
            const critical = [ollama, aion, sonchat, portal];
            const all_critical_online = critical.every((s) => s.status === "online");
            return ok({
                all_critical_online,
                note: "Critical = Ollama + Aion + SonChat + Portal. Fooocus is optional.",
                services: { ollama, aion, sonchat, portal, fooocus },
                env: {
                    OLLAMA_HOST,
                    OLLAMA_PORT,
                    AION_HOST,
                    AION_PORT,
                    SONCHAT_HOST,
                    SONCHAT_PORT,
                    PORTAL_HOST,
                    PORTAL_PORT,
                    FOOOCUS_URL,
                    AION_MODEL: process.env.AION_MODEL ?? "qwen3.5:9b (default)",
                },
            });
        }
        // -----------------------------------------------------------------------
        case "system_ollama_models": {
            try {
                const controller = new AbortController();
                setTimeout(() => controller.abort(), 6000);
                const res = await fetch(`http://${OLLAMA_HOST}:${OLLAMA_PORT}/api/tags`, {
                    signal: controller.signal,
                });
                if (!res.ok) {
                    return ok({ error: `Ollama returned HTTP ${res.status}` });
                }
                const data = await res.json();
                const models = (data.models ?? []).map((m) => ({
                    name: m.name,
                    size_gb: (m.size / 1e9).toFixed(2),
                    modified_at: m.modified_at,
                }));
                const aionModel = process.env.AION_MODEL ?? "mistral";
                const nebulaModel = process.env.NEBULA_MODEL ?? "phi3:mini";
                return ok({
                    count: models.length,
                    aion_model: aionModel,
                    aion_model_available: models.some((m) => m.name.startsWith(aionModel)),
                    nebula_model: nebulaModel,
                    nebula_model_available: models.some((m) => m.name.startsWith(nebulaModel)),
                    models,
                });
            }
            catch (err) {
                return ok({
                    error: `Cannot reach Ollama at ${OLLAMA_HOST}:${OLLAMA_PORT}`,
                    detail: err instanceof Error ? err.message : String(err),
                });
            }
        }
        // -----------------------------------------------------------------------
        default:
            throw new Error(`Unknown system tool: ${name}`);
    }
}
//# sourceMappingURL=system-tools.js.map