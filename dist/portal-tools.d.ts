import type { Tool } from "@modelcontextprotocol/sdk/types.js";
export declare const portalTools: Tool[];
type TextResult = {
    content: {
        type: "text";
        text: string;
    }[];
};
export declare function handlePortalTool(name: string, _args: Record<string, unknown>): Promise<TextResult>;
export {};
//# sourceMappingURL=portal-tools.d.ts.map