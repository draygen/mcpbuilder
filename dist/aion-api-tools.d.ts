import type { Tool } from "@modelcontextprotocol/sdk/types.js";
export declare const aionApiTools: Tool[];
type TextResult = {
    content: {
        type: "text";
        text: string;
    }[];
};
export declare function handleAionApiTool(name: string, args: Record<string, unknown>): Promise<TextResult>;
export {};
//# sourceMappingURL=aion-api-tools.d.ts.map