import { getDb, getJennDb } from "./db.js";
// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
export const memoryTools = [
    {
        name: "memory_get_facts",
        description: "Get user facts from AION's long-term memory. " +
            "Facts are personal details learned from conversations: preferences, family, work, hobbies, technical skills, goals. " +
            "Optionally filter by category.",
        inputSchema: {
            type: "object",
            properties: {
                category: {
                    type: "string",
                    enum: ["preferences", "family", "work", "hobbies", "technical", "goals", "personal"],
                    description: "Filter by category. Omit to return all facts.",
                },
                limit: {
                    type: "number",
                    description: "Max facts to return (default: 200)",
                },
            },
        },
    },
    {
        name: "memory_add_fact",
        description: "Add a new fact to AION's long-term memory. This fact will be injected into every future AION conversation.",
        inputSchema: {
            type: "object",
            properties: {
                category: {
                    type: "string",
                    enum: ["preferences", "family", "work", "hobbies", "technical", "goals", "personal"],
                    description: "The category this fact belongs to",
                },
                fact: {
                    type: "string",
                    description: "The fact to remember (e.g. 'Prefers dark roast coffee', 'Has a daughter named Zoe')",
                },
            },
            required: ["category", "fact"],
        },
    },
    {
        name: "memory_delete_fact",
        description: "Delete a fact from AION's long-term memory by its ID. Use memory_get_facts first to find the ID.",
        inputSchema: {
            type: "object",
            properties: {
                id: {
                    type: "number",
                    description: "The integer ID of the fact to delete",
                },
            },
            required: ["id"],
        },
    },
    {
        name: "memory_search",
        description: "Search AION's memory for a keyword. Searches across both user facts and conversation summaries. " +
            "Returns matching facts and conversation metadata.",
        inputSchema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Keyword or phrase to search for",
                },
            },
            required: ["query"],
        },
    },
    {
        name: "memory_get_context",
        description: "Get the full memory context that AION injects into its system prompt — the last 10 conversation summaries plus all user facts, " +
            "formatted exactly as AION sees them. Useful for auditing what AION knows.",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "conversation_list",
        description: "List recent AION conversations with titles, tool types, and auto-generated summaries.",
        inputSchema: {
            type: "object",
            properties: {
                limit: {
                    type: "number",
                    description: "Number of conversations to return (default: 20, max: 100)",
                },
                tool: {
                    type: "string",
                    enum: ["query", "agent", "web", "api"],
                    description: "Filter to a specific tool type",
                },
            },
        },
    },
    {
        name: "conversation_get",
        description: "Get the full message history of a specific AION conversation including all user and assistant turns.",
        inputSchema: {
            type: "object",
            properties: {
                conversation_id: {
                    type: "number",
                    description: "The integer ID of the conversation (from conversation_list)",
                },
            },
            required: ["conversation_id"],
        },
    },
    {
        name: "conversation_search",
        description: "Search through AION conversation titles and summaries for a keyword.",
        inputSchema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Keyword or phrase to find in conversation titles/summaries",
                },
                limit: {
                    type: "number",
                    description: "Max results (default: 10)",
                },
            },
            required: ["query"],
        },
    },
    {
        name: "jenn_get_profile",
        description: "Get profile data about Jenn (Brian's wife) from AION's Jenn memory database.",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "jenn_get_memories",
        description: "Get memories about Jenn from AION's Jenn memory database. " +
            "Optionally filter by category: biography, relationship, family, interests, life_events.",
        inputSchema: {
            type: "object",
            properties: {
                category: {
                    type: "string",
                    description: "Category filter (biography | relationship | family | interests | life_events). Omit for all.",
                },
            },
        },
    },
];
function ok(data) {
    return {
        content: [
            {
                type: "text",
                text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
            },
        ],
    };
}
// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
export async function handleMemoryTool(name, args) {
    const db = getDb();
    switch (name) {
        // -----------------------------------------------------------------------
        case "memory_get_facts": {
            const { category, limit = 200 } = args;
            const params = [];
            let sql = "SELECT id, category, fact, created_at FROM user_facts";
            if (category) {
                sql += " WHERE category = ?";
                params.push(category);
            }
            sql += " ORDER BY category, created_at DESC LIMIT ?";
            params.push(limit);
            const rows = db.prepare(sql).all(...params);
            // Group by category
            const grouped = {};
            for (const row of rows) {
                (grouped[row.category] ??= []).push(row);
            }
            return ok({ total: rows.length, by_category: grouped });
        }
        // -----------------------------------------------------------------------
        case "memory_add_fact": {
            const { category, fact } = args;
            try {
                const res = db
                    .prepare("INSERT INTO user_facts (category, fact) VALUES (?, ?)")
                    .run(category, fact);
                return ok({ success: true, id: res.lastInsertRowid, message: `Fact saved with ID ${res.lastInsertRowid}` });
            }
            catch (err) {
                if (err.message?.includes("UNIQUE")) {
                    return ok({ success: false, message: "That fact already exists in memory." });
                }
                throw err;
            }
        }
        // -----------------------------------------------------------------------
        case "memory_delete_fact": {
            const { id } = args;
            const res = db.prepare("DELETE FROM user_facts WHERE id = ?").run(id);
            if (res.changes === 0) {
                return ok({ success: false, message: `No fact found with ID ${id}` });
            }
            return ok({ success: true, message: `Fact ${id} deleted from memory` });
        }
        // -----------------------------------------------------------------------
        case "memory_search": {
            const { query } = args;
            const like = `%${query}%`;
            const facts = db
                .prepare("SELECT id, category, fact, created_at FROM user_facts WHERE fact LIKE ? ORDER BY created_at DESC LIMIT 30")
                .all(like);
            const convs = db
                .prepare("SELECT id, title, tool, summary, created_at FROM conversations " +
                "WHERE summary LIKE ? OR title LIKE ? ORDER BY updated_at DESC LIMIT 15")
                .all(like, like);
            return ok({
                query,
                facts_found: facts.length,
                facts,
                conversations_found: convs.length,
                conversations: convs,
            });
        }
        // -----------------------------------------------------------------------
        case "memory_get_context": {
            const summaries = db
                .prepare("SELECT summary FROM conversations WHERE summary IS NOT NULL ORDER BY updated_at DESC LIMIT 10")
                .all();
            const facts = db
                .prepare("SELECT category, fact FROM user_facts ORDER BY category, created_at")
                .all();
            let ctx = "=== AION MEMORY CONTEXT ===\n";
            ctx += `(${summaries.length} recent summaries, ${facts.length} stored facts)\n\n`;
            if (summaries.length > 0) {
                ctx += "--- Recent Conversation Summaries (newest first) ---\n";
                summaries.forEach((s, i) => {
                    ctx += `${i + 1}. ${s.summary}\n`;
                });
                ctx += "\n";
            }
            if (facts.length > 0) {
                ctx += "--- User Facts ---\n";
                const byCategory = {};
                for (const f of facts) {
                    (byCategory[f.category] ??= []).push(f.fact);
                }
                for (const [cat, list] of Object.entries(byCategory)) {
                    ctx += `\n[${cat.toUpperCase()}]\n`;
                    list.forEach((f) => (ctx += `  • ${f}\n`));
                }
            }
            return ok(ctx);
        }
        // -----------------------------------------------------------------------
        case "conversation_list": {
            const { limit = 20, tool } = args;
            const params = [];
            let sql = "SELECT id, title, tool, mode, created_at, updated_at, summary FROM conversations";
            if (tool) {
                sql += " WHERE tool = ?";
                params.push(tool);
            }
            sql += " ORDER BY updated_at DESC LIMIT ?";
            params.push(Math.min(Number(limit), 100));
            const rows = db.prepare(sql).all(...params);
            return ok({ total: rows.length, conversations: rows });
        }
        // -----------------------------------------------------------------------
        case "conversation_get": {
            const { conversation_id } = args;
            const conv = db
                .prepare("SELECT id, title, tool, mode, created_at, updated_at, summary FROM conversations WHERE id = ?")
                .get(conversation_id);
            if (!conv) {
                return ok({ error: `No conversation with ID ${conversation_id}` });
            }
            const messages = db
                .prepare("SELECT role, content, timestamp FROM messages WHERE conversation_id = ? ORDER BY timestamp")
                .all(conversation_id);
            return ok({ conversation: conv, message_count: messages.length, messages });
        }
        // -----------------------------------------------------------------------
        case "conversation_search": {
            const { query, limit = 10 } = args;
            const like = `%${query}%`;
            const rows = db
                .prepare("SELECT id, title, tool, summary, created_at FROM conversations " +
                "WHERE summary LIKE ? OR title LIKE ? ORDER BY updated_at DESC LIMIT ?")
                .all(like, like, Math.min(Number(limit), 50));
            return ok({ query, results: rows.length, conversations: rows });
        }
        // -----------------------------------------------------------------------
        case "jenn_get_profile": {
            const jdb = getJennDb();
            if (!jdb) {
                return ok({ error: "Jenn database not found. Expected at /mnt/c/aion_v2/data/jenn/jenn.db" });
            }
            const rows = jdb.prepare("SELECT key, value FROM profile").all();
            return ok({ profile: rows });
        }
        // -----------------------------------------------------------------------
        case "jenn_get_memories": {
            const jdb = getJennDb();
            if (!jdb) {
                return ok({ error: "Jenn database not found. Expected at /mnt/c/aion_v2/data/jenn/jenn.db" });
            }
            const { category } = args;
            const params = [];
            let sql = "SELECT id, category, content FROM memories";
            if (category) {
                sql += " WHERE category = ?";
                params.push(category);
            }
            const rows = jdb.prepare(sql).all(...params);
            return ok({ total: rows.length, memories: rows });
        }
        // -----------------------------------------------------------------------
        default:
            throw new Error(`Unknown memory tool: ${name}`);
    }
}
//# sourceMappingURL=memory-tools.js.map