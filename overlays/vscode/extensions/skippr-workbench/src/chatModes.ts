export type SkipprChatModeId = "ask" | "plan" | "agent";

export interface SkipprChatMode {
  readonly id: SkipprChatModeId;
  readonly label: string;
  readonly cliCommand?: "ask" | "plan";
  readonly canMutate: boolean;
  readonly canRunModel: boolean;
  readonly description: string;
}

export const skipprChatModes: readonly SkipprChatMode[] = [
  {
    id: "ask",
    label: "Ask",
    cliCommand: "ask",
    canMutate: false,
    canRunModel: false,
    description: "Read-only answers over workspace, catalog, lineage, docs, and thread context."
  },
  {
    id: "plan",
    label: "Plan",
    cliCommand: "plan",
    canMutate: false,
    canRunModel: false,
    description: "Discovery and planning without applying modeling or warehouse changes."
  },
  {
    id: "agent",
    label: "Agent",
    canMutate: true,
    canRunModel: true,
    description: "Tool-running mode that can invoke Skippr model as a shared subagent/run target."
  }
] as const;

export function isSkipprChatModeId(value: unknown): value is SkipprChatModeId {
  return value === "ask" || value === "plan" || value === "agent";
}

export function skipprChatModeFor(id: SkipprChatModeId): SkipprChatMode {
  return skipprChatModes.find((mode) => mode.id === id) ?? skipprChatModes[0];
}
