#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, ErrorCode, McpError, } from "@modelcontextprotocol/sdk/types.js";
import { memoryTools, handleMemoryTool } from "./memory-tools.js";
import { systemTools, handleSystemTool } from "./system-tools.js";
import { chatTools, handleChatTool } from "./chat-tools.js";
import { kaliTools, handleKaliTool } from "./kali-tools.js";
import { aionApiTools, handleAionApiTool } from "./aion-api-tools.js";
import { sonchatTools, handleSonchatTool } from "./sonchat-tools.js";
import { portalTools, handlePortalTool } from "./portal-tools.js";
import { fleetTools, handleFleetTool } from "./fleet-tools.js";
import { closeAll } from "./db.js";
// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------
const server = new Server({ name: "aion-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });
const allTools = [
    ...memoryTools,
    ...systemTools,
    ...chatTools,
    ...kaliTools,
    ...aionApiTools,
    ...sonchatTools,
    ...portalTools,
    ...fleetTools,
];
// Tool name → handler mapping
const memoryToolNames = new Set(memoryTools.map((t) => t.name));
const systemToolNames = new Set(systemTools.map((t) => t.name));
const chatToolNames = new Set(chatTools.map((t) => t.name));
const kaliToolNames = new Set(kaliTools.map((t) => t.name));
const aionApiToolNames = new Set(aionApiTools.map((t) => t.name));
const sonchatToolNames = new Set(sonchatTools.map((t) => t.name));
const portalToolNames = new Set(portalTools.map((t) => t.name));
const fleetToolNames = new Set(fleetTools.map((t) => t.name));
// ---------------------------------------------------------------------------
// Request handlers
// ---------------------------------------------------------------------------
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: allTools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const a = (args ?? {});
    try {
        if (memoryToolNames.has(name))
            return await handleMemoryTool(name, a);
        if (systemToolNames.has(name))
            return await handleSystemTool(name, a);
        if (chatToolNames.has(name))
            return await handleChatTool(name, a);
        if (kaliToolNames.has(name))
            return await handleKaliTool(name, a);
        if (aionApiToolNames.has(name))
            return await handleAionApiTool(name, a);
        if (sonchatToolNames.has(name))
            return await handleSonchatTool(name, a);
        if (portalToolNames.has(name))
            return await handlePortalTool(name, a);
        if (fleetToolNames.has(name))
            return await handleFleetTool(name, a);
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    catch (err) {
        if (err instanceof McpError)
            throw err;
        // Surface errors as a readable text response rather than a hard MCP error
        const msg = err instanceof Error ? err.message : String(err);
        return {
            content: [{ type: "text", text: `Error in tool "${name}": ${msg}` }],
            isError: true,
        };
    }
});
// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // Graceful shutdown
    const shutdown = () => {
        closeAll();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}
main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map