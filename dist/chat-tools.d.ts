import type { Tool } from "@modelcontextprotocol/sdk/types.js";
export declare const chatTools: Tool[];
type TextResult = {
    content: {
        type: "text";
        text: string;
    }[];
};
export declare function handleChatTool(name: string, args: Record<string, unknown>): Promise<TextResult>;
export {};
//# sourceMappingURL=chat-tools.d.ts.map