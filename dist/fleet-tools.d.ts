import type { Tool } from "@modelcontextprotocol/sdk/types.js";
type TextResult = {
    content: [{
        type: "text";
        text: string;
    }];
    isError?: boolean;
};
export declare const fleetTools: Tool[];
export declare function handleFleetTool(name: string, args: Record<string, unknown>): Promise<TextResult>;
export {};
//# sourceMappingURL=fleet-tools.d.ts.map