import type { BaseAgentConfig, BaseRunConfig,BaseAgentViewConfig } from "agentview/baseConfigTypes";
import type { AgentConfig, AgentViewConfig } from "./types";
import { z } from "zod";

export function toBaseConfig(config: AgentViewConfig): BaseAgentViewConfig {
  const { agents, ...rest } = config;

  return {
    ...rest,
    agents: agents?.map(mapAgent),
  };
}

function mapAgent(agent: AgentConfig): BaseAgentConfig {
  const { userMessage, assistantMessage, ...shared } = agent;

  const run: BaseRunConfig = {
    input: {
      schema: z.looseObject({
        id: z.string(),
        role: z.literal("user"),
        parts: z.array(z.looseObject({
          type: z.string(),
        })),
      }),
    },
    output: (assistantMessage?.parts ?? []).map((part) => ({
      schema: z.looseObject({
        type: z.literal(part.type),
      }),
    })),
    scores: assistantMessage?.scores,
    validateOutput: false,
  };

  return {
    ...shared,
    runs: [run],
  };
}

