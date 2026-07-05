import type { Tool } from "@modelcontextprotocol/sdk/types.js";
export declare const memoryTools: Tool[];
type TextResult = {
    content: {
        type: "text";
        text: string;
    }[];
};
export declare function handleMemoryTool(name: string, args: Record<string, unknown>): Promise<TextResult>;
export {};
//# sourceMappingURL=memory-tools.d.ts.map