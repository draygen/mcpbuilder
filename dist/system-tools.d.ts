import type { Tool } from "@modelcontextprotocol/sdk/types.js";
export declare const systemTools: Tool[];
type TextResult = {
    content: {
        type: "text";
        text: string;
    }[];
};
export declare function handleSystemTool(name: string, _args: Record<string, unknown>): Promise<TextResult>;
export {};
//# sourceMappingURL=system-tools.d.ts.map