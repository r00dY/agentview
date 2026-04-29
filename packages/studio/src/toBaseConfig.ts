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
  const { run, ...shared } = agent;

  const baseRun: BaseRunConfig = {
    input: {
      schema: z.looseObject({
        id: z.string(),
        role: z.literal("user"),
        parts: z.array(z.looseObject({
          type: z.string(),
        })),
      }),
    },
    output: (run?.assistantMessage?.parts ?? []).map((part) => ({
      schema: z.looseObject({
        type: z.literal(part.type),
      }),
    })),
    scores: run?.scores,
    validateOutput: false,
  };

  return {
    ...shared,
    adapter: 'ai-sdk',
    runs: [baseRun],
  };
}

