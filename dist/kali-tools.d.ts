import type { Tool } from "@modelcontextprotocol/sdk/types.js";
type TextResult = {
    content: [{
        type: "text";
        text: string;
    }];
    isError?: boolean;
};
export declare const kaliTools: Tool[];
export declare function handleKaliTool(name: string, args: Record<string, unknown>): Promise<TextResult>;
export {};
//# sourceMappingURL=kali-tools.d.ts.map