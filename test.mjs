#!/usr/bin/env node
/**
 * aion-mcp test runner
 * Spawns the MCP server, sends JSON-RPC tool calls, reports pass/fail for each.
 */
import { spawn } from "child_process";
import { createInterface } from "readline";

const SERVER = new URL("./dist/index.js", import.meta.url).pathname;

// ---------------------------------------------------------------------------
// MCP JSON-RPC client over stdio
// ---------------------------------------------------------------------------
let msgId = 1;
let proc;
const pending = new Map();

function startServer() {
  proc = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "inherit"] });
  const rl = createInterface({ input: proc.stdout });
  rl.on("line", (line) => {
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    } catch { /* ignore non-JSON */ }
  });
  proc.on("exit", (code) => {
    if (code !== 0 && code !== null) console.error(`Server exited with code ${code}`);
  });
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = msgId++;
    pending.set(id, { resolve, reject });
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`Timeout waiting for response to ${method}`));
      }
    }, 60000);
  });
}

async function initialize() {
  return send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-runner", version: "1.0" },
  });
}

async function callTool(name, args = {}) {
  return send("tools/call", { name, arguments: args });
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
const WARN = "\x1b[33m~\x1b[0m";
const results = [];

function extractText(response) {
  try {
    return response?.result?.content?.[0]?.text ?? "";
  } catch {
    return "";
  }
}

function extractJSON(response) {
  try {
    return JSON.parse(extractText(response));
  } catch {
    return null;
  }
}

async function test(label, toolName, args, validator) {
  try {
    const res = await callTool(toolName, args);
    if (res.error) {
      console.log(`  ${FAIL} ${label}`);
      console.log(`       RPC error: ${res.error.message}`);
      results.push({ label, status: "FAIL" });
      return;
    }
    const text = extractText(res);
    const data = extractJSON(res);
    const issue = validator(text, data, res);
    if (issue === true || issue === null || issue === undefined) {
      console.log(`  ${PASS} ${label}`);
      results.push({ label, status: "PASS" });
    } else if (typeof issue === "string" && issue.startsWith("WARN:")) {
      console.log(`  ${WARN} ${label} — ${issue.slice(5)}`);
      results.push({ label, status: "WARN" });
    } else {
      console.log(`  ${FAIL} ${label} — ${issue}`);
      console.log(`       Raw: ${text.slice(0, 200)}`);
      results.push({ label, status: "FAIL" });
    }
  } catch (err) {
    console.log(`  ${FAIL} ${label} — ${err.message}`);
    results.push({ label, status: "FAIL" });
  }
}

// ---------------------------------------------------------------------------
// Main test suite
// ---------------------------------------------------------------------------
async function run() {
  console.log("\n\x1b[1maion-mcp test suite\x1b[0m\n");

  startServer();
  await initialize();

  // ── List tools ────────────────────────────────────────────────────────────
  console.log("\x1b[1m[bootstrap]\x1b[0m");
  const toolsRes = await send("tools/list");
  const tools = toolsRes?.result?.tools ?? [];
  console.log(`  ${PASS} Server started & initialized (${tools.length} tools registered)`);
  if (tools.length !== 15) {
    console.log(`  ${WARN} Expected 15 tools, got ${tools.length}`);
  }

  // ── Memory tools ──────────────────────────────────────────────────────────
  console.log("\n\x1b[1m[memory tools]\x1b[0m");

  await test("memory_get_facts (all)", "memory_get_facts", {}, (_, d) =>
    d && typeof d.total === "number" ? true : "missing total field"
  );

  await test("memory_get_facts (by category: technical)", "memory_get_facts", { category: "technical" }, (_, d) =>
    d && typeof d.total === "number" ? true : "missing total field"
  );

  // Add a fact, then verify, then delete it
  let addedId = null;
  await test("memory_add_fact", "memory_add_fact", {
    category: "technical",
    fact: "__mcp_test_fact__ (safe to delete)",
  }, (_, d) => {
    if (d?.success && d?.id) { addedId = d.id; return true; }
    if (d?.success === false && d?.message?.includes("already exists")) return true; // idempotent
    return "unexpected response";
  });

  await test("memory_search", "memory_search", { query: "__mcp_test_fact__" }, (_, d) =>
    d && (d.facts_found >= 0) ? true : "missing facts_found"
  );

  if (addedId) {
    await test("memory_delete_fact", "memory_delete_fact", { id: addedId }, (_, d) =>
      d?.success ? true : `delete failed: ${d?.message}`
    );
  } else {
    console.log(`  ${WARN} memory_delete_fact — skipped (no id from add step)`);
    results.push({ label: "memory_delete_fact", status: "WARN" });
  }

  await test("memory_get_context", "memory_get_context", {}, (text) =>
    text.includes("AION MEMORY CONTEXT") ? true : "expected header not found in output"
  );

  // ── Conversation tools ────────────────────────────────────────────────────
  console.log("\n\x1b[1m[conversation tools]\x1b[0m");

  let firstConvId = null;
  await test("conversation_list", "conversation_list", { limit: 5 }, (_, d) => {
    if (!d || typeof d.total !== "number") return "missing total";
    if (d.conversations?.length > 0) firstConvId = d.conversations[0].id;
    return true;
  });

  if (firstConvId) {
    await test("conversation_get", "conversation_get", { conversation_id: firstConvId }, (_, d) =>
      d?.conversation && Array.isArray(d.messages) ? true : "missing conversation or messages"
    );
  } else {
    console.log(`  ${WARN} conversation_get — skipped (no conversations in DB yet)`);
    results.push({ label: "conversation_get", status: "WARN" });
  }

  await test("conversation_search", "conversation_search", { query: "a" }, (_, d) =>
    d && typeof d.results === "number" ? true : "missing results count"
  );

  // ── Jenn tools ────────────────────────────────────────────────────────────
  console.log("\n\x1b[1m[jenn tools]\x1b[0m");

  await test("jenn_get_profile", "jenn_get_profile", {}, (_, d) => {
    if (d?.error?.includes("not found")) return "WARN:Jenn DB not found (expected if jenn.db absent)";
    return Array.isArray(d?.profile) ? true : "unexpected response";
  });

  await test("jenn_get_memories", "jenn_get_memories", {}, (_, d) => {
    if (d?.error?.includes("not found")) return "WARN:Jenn DB not found";
    return typeof d?.total === "number" ? true : "unexpected response";
  });

  // ── System tools ──────────────────────────────────────────────────────────
  console.log("\n\x1b[1m[system tools]\x1b[0m");

  await test("system_status", "system_status", {}, (_, d) => {
    if (!d?.services) return "missing services field";
    const { ollama, aionWeb, aionPublic, fooocus } = d.services;
    console.log(`       Ollama: ${ollama?.status}  WebAPI: ${aionWeb?.status}  PublicAPI: ${aionPublic?.status}  Fooocus: ${fooocus?.status}`);
    return ollama?.status === "online" ? true : "WARN:Ollama offline — most chat tools will fail";
  });

  await test("system_ollama_models", "system_ollama_models", {}, (_, d) => {
    if (!d?.models) return "missing models array";
    console.log(`       ${d.count} models — AION: ${d.aion_model} (${d.aion_model_available ? "available" : "MISSING"}), Nebula: ${d.nebula_model} (${d.nebula_model_available ? "available" : "MISSING"})`);
    return d.count > 0 ? true : "no models found";
  });

  // ── Chat tools ────────────────────────────────────────────────────────────
  console.log("\n\x1b[1m[chat tools]\x1b[0m");

  await test("aion_query", "aion_query", { message: "Reply with exactly: AION_MCP_TEST_OK" }, (_, d) => {
    if (!d?.response) return "no response field";
    console.log(`       source: ${d.source}`);
    console.log(`       reply snippet: ${d.response?.slice(0, 100)}`);
    return true;
  });

  await test("ollama_query", "ollama_query", {
    prompt: "Reply with exactly: OLLAMA_MCP_TEST_OK",
    model: "mistral",
  }, (_, d) => {
    if (!d?.response) return "no response field";
    console.log(`       timing: ${d.timing?.total_ms}ms`);
    console.log(`       reply snippet: ${d.response?.slice(0, 80)}`);
    return true;
  });

  // ── Image tool ────────────────────────────────────────────────────────────
  console.log("\n\x1b[1m[image tools]\x1b[0m");

  await test("image_generate", "image_generate", {
    prompt: "a simple red circle on white background",
    performance: "Extreme Speed",
  }, (_, d) => {
    if (d?.error?.includes("Cannot reach Fooocus")) return "WARN:Fooocus offline — image generation unavailable";
    if (d?.success) {
      console.log(`       image: ${d.image_url ?? d.filename}`);
      return true;
    }
    return `unexpected: ${JSON.stringify(d).slice(0, 100)}`;
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.status === "PASS").length;
  const warned = results.filter((r) => r.status === "WARN").length;
  const failed = results.filter((r) => r.status === "FAIL").length;

  console.log(`\n\x1b[1mResults: ${passed} passed  ${warned} warned  ${failed} failed\x1b[0m`);
  if (failed > 0) {
    console.log("Failed tools:");
    results.filter((r) => r.status === "FAIL").forEach((r) => console.log(`  • ${r.label}`));
  }

  proc.stdin.end();
  proc.kill();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Test runner crashed:", err);
  proc?.kill();
  process.exit(1);
});
