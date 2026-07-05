import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "127.0.0.1";
const OLLAMA_PORT = process.env.OLLAMA_PORT ?? "11434";
const AION_MODEL = process.env.AION_MODEL ?? "mistral";
const AION_PUBLIC_PORT = process.env.AION_PUBLIC_API_PORT ?? "3003";
const FOOOCUS_URL = process.env.FOOOCUS_URL ?? "http://127.0.0.1:8888";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o";

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const chatTools: Tool[] = [
  {
    name: "aion_query",
    description:
      "Send a message to AION via its public REST API (port 3003). " +
      "AION will respond with full memory context (facts + summaries) injected. " +
      "Automatically falls back to a direct Ollama query (without memory) if the API is offline.",
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "The message to send to AION",
        },
      },
      required: ["message"],
    },
  },
  {
    name: "ollama_query",
    description:
      "Send a raw prompt directly to Ollama, bypassing AION's persona and memory. " +
      "Useful for model testing, one-off queries, or comparing model outputs.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "The prompt text to send",
        },
        model: {
          type: "string",
          description: `Ollama model name (default: ${AION_MODEL})`,
        },
        system: {
          type: "string",
          description: "Optional system prompt override",
        },
        temperature: {
          type: "number",
          description: "Sampling temperature 0.0–2.0 (default: 0.7)",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "openai_query",
    description:
      "Send a raw prompt directly to OpenAI (GPT-4o by default), bypassing AION's persona and memory. " +
      "Useful for one-off queries, comparing model outputs, or when Ollama is unavailable.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "The prompt text to send",
        },
        model: {
          type: "string",
          description: `OpenAI model name (default: ${OPENAI_MODEL})`,
        },
        system: {
          type: "string",
          description: "Optional system prompt override",
        },
        temperature: {
          type: "number",
          description: "Sampling temperature 0.0–2.0 (default: 0.7)",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "image_generate",
    description:
      "Generate an image using Fooocus (Stable Diffusion XL) running locally. " +
      "Submits the job, polls until complete (up to 5 min), and returns the image URL/path.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Detailed image description/prompt for Stable Diffusion",
        },
        negative_prompt: {
          type: "string",
          description: "What to avoid in the image (optional)",
        },
        style: {
          type: "string",
          description: "Style preset (default: Fooocus V2)",
          enum: [
            "Fooocus V2",
            "Fooocus Enhance",
            "Fooocus Sharp",
            "SAI Anime",
            "SAI Comic Book",
            "SAI Digital Art",
            "SAI Fantasy Art",
            "SAI Photographic",
          ],
        },
        ratio: {
          type: "string",
          description: "Aspect ratio (default: 1152×896 — landscape)",
          enum: [
            "1152×896",
            "896×1152",
            "1216×832",
            "832×1216",
            "1344×768",
            "768×1344",
            "1024×1024",
          ],
        },
        performance: {
          type: "string",
          enum: ["Speed", "Quality", "Extreme Speed"],
          description: "Generation quality/speed tradeoff (default: Speed)",
        },
      },
      required: ["prompt"],
    },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type TextResult = { content: { type: "text"; text: string }[] };

function ok(data: unknown): TextResult {
  return {
    content: [
      {
        type: "text",
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleChatTool(
  name: string,
  args: Record<string, unknown>
): Promise<TextResult> {
  switch (name) {
    // -----------------------------------------------------------------------
    case "aion_query": {
      const { message } = args as { message: string };

      // 1. Try AION Public API (includes memory context)
      try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 45000);
        const res = await fetch(`http://localhost:${AION_PUBLIC_PORT}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
          signal: controller.signal,
        });
        if (res.ok) {
          const data = await res.json() as { reply?: string; response?: string; model?: string };
          return ok({
            source: `AION Public API (port ${AION_PUBLIC_PORT})`,
            model: data.model,
            memory_injected: true,
            response: data.reply ?? data.response,
          });
        }
      } catch {
        // fall through to Ollama
      }

      // 2. Fall back to OpenAI (no memory)
      if (OPENAI_API_KEY) {
        try {
          const controller = new AbortController();
          setTimeout(() => controller.abort(), 45000);
          const messages: { role: string; content: string }[] = [{ role: "user", content: message }];
          const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
            body: JSON.stringify({ model: OPENAI_MODEL, messages }),
            signal: controller.signal,
          });
          if (res.ok) {
            const data = await res.json() as { model?: string; choices?: { message?: { content?: string } }[] };
            return ok({
              source: `OpenAI fallback (${data.model ?? OPENAI_MODEL})`,
              model: data.model ?? OPENAI_MODEL,
              memory_injected: false,
              warning: "AION Public API was offline — memory context NOT injected.",
              response: data.choices?.[0]?.message?.content,
            });
          }
        } catch {
          // fall through to Ollama
        }
      }

      // 3. Last resort: direct Ollama (no memory)
      try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 45000);
        const res = await fetch(`http://${OLLAMA_HOST}:${OLLAMA_PORT}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: AION_MODEL, prompt: message, stream: false }),
          signal: controller.signal,
        });
        if (!res.ok) {
          return ok({ error: "AION Public API, OpenAI, and Ollama are all unavailable." });
        }
        const data = await res.json() as { response?: string };
        return ok({
          source: `Ollama direct (${AION_MODEL})`,
          model: AION_MODEL,
          memory_injected: false,
          warning: "AION Public API was offline — memory context NOT injected.",
          response: data.response,
        });
      } catch (err) {
        return ok({
          error: "Cannot reach AION, OpenAI, or Ollama",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // -----------------------------------------------------------------------
    case "ollama_query": {
      const {
        prompt,
        model = AION_MODEL,
        system,
        temperature = 0.7,
      } = args as { prompt: string; model?: string; system?: string; temperature?: number };

      try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 90000);
        const body: Record<string, unknown> = {
          model,
          prompt,
          stream: false,
          options: { temperature },
        };
        if (system) body.system = system;

        const res = await fetch(`http://${OLLAMA_HOST}:${OLLAMA_PORT}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.ok) {
          return ok({ error: `Ollama returned HTTP ${res.status}` });
        }
        const data = await res.json() as {
          response?: string;
          eval_duration?: number;
          prompt_eval_duration?: number;
          total_duration?: number;
        };
        return ok({
          model,
          response: data.response,
          timing: {
            prompt_ms: data.prompt_eval_duration ? Math.round(data.prompt_eval_duration / 1e6) : null,
            eval_ms: data.eval_duration ? Math.round(data.eval_duration / 1e6) : null,
            total_ms: data.total_duration ? Math.round(data.total_duration / 1e6) : null,
          },
        });
      } catch (err) {
        return ok({
          error: `Ollama unavailable at ${OLLAMA_HOST}:${OLLAMA_PORT}`,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // -----------------------------------------------------------------------
    case "openai_query": {
      const {
        prompt,
        model = OPENAI_MODEL,
        system,
        temperature = 0.7,
      } = args as { prompt: string; model?: string; system?: string; temperature?: number };

      if (!OPENAI_API_KEY) {
        return ok({ error: "OPENAI_API_KEY is not set. Add it to your environment." });
      }

      try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 90000);
        const messages: { role: string; content: string }[] = [];
        if (system) messages.push({ role: "system", content: system });
        messages.push({ role: "user", content: prompt });

        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
          body: JSON.stringify({ model, messages, temperature }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          return ok({ error: `OpenAI returned HTTP ${res.status}`, body });
        }
        const data = await res.json() as {
          model?: string;
          choices?: { message?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };
        return ok({
          model: data.model ?? model,
          response: data.choices?.[0]?.message?.content,
          usage: data.usage,
        });
      } catch (err) {
        return ok({
          error: "OpenAI request failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // -----------------------------------------------------------------------
    case "image_generate": {
      const {
        prompt,
        negative_prompt = "",
        style = "Fooocus V2",
        ratio = "1152×896",
        performance = "Speed",
      } = args as {
        prompt: string;
        negative_prompt?: string;
        style?: string;
        ratio?: string;
        performance?: string;
      };

      // Submit the async job
      try {
        const submitCtrl = new AbortController();
        setTimeout(() => submitCtrl.abort(), 12000);

        const submitRes = await fetch(`${FOOOCUS_URL}/v1/generation/text-to-image`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            negative_prompt,
            style_selections: [style],
            performance_selection: performance,
            aspect_ratios_selection: ratio,
            image_number: 1,
            async_process: true,
          }),
          signal: submitCtrl.signal,
        });

        if (!submitRes.ok) {
          const body = await submitRes.text().catch(() => "");
          return ok({ error: `Fooocus rejected the request (HTTP ${submitRes.status})`, body });
        }

        const job = await submitRes.json() as { job_id?: string };
        const jobId = job.job_id;
        if (!jobId) {
          return ok({ error: "Fooocus did not return a job_id. Is Fooocus-API running?" });
        }

        // Poll for completion — 2s interval, 5 min max
        const maxAttempts = 150;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          await sleep(2000);

          try {
            const pollRes = await fetch(
              `${FOOOCUS_URL}/v1/generation/query-job?job_id=${jobId}`
            );
            if (!pollRes.ok) continue;

            const status = await pollRes.json() as {
              job_stage?: string;
              job_progress?: number;
              job_result?: { url?: string; filename?: string }[];
            };

            if (status.job_stage === "SUCCESS" && status.job_result?.[0]) {
              const result = status.job_result[0];
              return ok({
                success: true,
                job_id: jobId,
                attempts: attempt + 1,
                elapsed_seconds: (attempt + 1) * 2,
                image_url: result.url,
                filename: result.filename,
                prompt,
                style,
                ratio,
                performance,
              });
            }

            if (status.job_stage === "FAILED") {
              return ok({
                success: false,
                job_id: jobId,
                error: "Fooocus reported job FAILED",
                attempts: attempt + 1,
              });
            }
          } catch {
            // transient poll failure — keep retrying
          }
        }

        return ok({
          success: false,
          job_id: jobId,
          error: "Timed out after 5 minutes waiting for image generation",
          note: "The job may still be running — check Fooocus directly",
        });
      } catch (err) {
        return ok({
          error: `Cannot reach Fooocus at ${FOOOCUS_URL}`,
          detail: err instanceof Error ? err.message : String(err),
          hint: "Start Fooocus with: bash /mnt/c/aion_v2/fooocus-setup.sh start",
        });
      }
    }

    // -----------------------------------------------------------------------
    default:
      throw new Error(`Unknown chat tool: ${name}`);
  }
}
