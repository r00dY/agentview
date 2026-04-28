import type { BaseAgentConfig, BaseAgentViewConfig } from "agentview/baseConfigTypes";
import type { AgentConfig, AgentViewConfig, RunConfig } from "./types";
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

  const run: RunConfig = {
    input: {
      schema: z.looseObject({
        id: z.string(),
        role: z.literal("user"),
        parts: z.array(z.looseObject({
          type: z.string(),
        })),
      }),
      displayComponent: userMessage.displayComponent// ?? DefaultUserMessageDisplayComponent
    },
    output: (assistantMessage.parts ?? []).map((part) => ({
      schema: z.looseObject({
        type: z.literal(part.type),
      }),
      displayComponent: part.displayComponent
    })),
    scores: assistantMessage.scores,
    displayProperties: assistantMessage.displayProperties,
    disableLike: assistantMessage.disableLike,
    validateOutput: false,
  };

  return {
    ...shared,
    runs: [run],
  };
}

