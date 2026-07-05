import type { Tool } from "@modelcontextprotocol/sdk/types.js";
type Machine = "wsl" | "draydev" | "ec2";
type AgentName = "claude" | "codex" | "agy";
type TextResult = {
    content: [{
        type: "text";
        text: string;
    }];
    isError?: boolean;
};
export type FleetCheck = {
    agent: AgentName;
    machine: Machine;
    ok: boolean;
    detail: string;
};
export declare function runFleetStatus(filter?: {
    machine?: Machine;
    agent?: AgentName;
}): Promise<FleetCheck[]>;
export declare const fleetTools: Tool[];
export declare function handleFleetTool(name: string, args: Record<string, unknown>): Promise<TextResult>;
export {};
//# sourceMappingURL=fleet-tools.d.ts.map