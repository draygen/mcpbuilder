import type { Tool } from "@modelcontextprotocol/sdk/types.js";
export declare const sonchatTools: Tool[];
type TextResult = {
    content: {
        type: "text";
        text: string;
    }[];
};
export declare function handleSonchatTool(name: string, args: Record<string, unknown>): Promise<TextResult>;
export {};
//# sourceMappingURL=sonchat-tools.d.ts.map