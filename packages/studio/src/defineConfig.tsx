import { like } from "./scores";
import type { AgentViewConfig } from "./types";

export function defineConfig(config: AgentViewConfig): AgentViewConfig {
  return {
    ...config,
    agents: config.agents?.map((agent) => {

      const scores = [...(agent.assistantMessage?.scores ?? [])];
      if (!agent.assistantMessage?.disableLike) {
        scores.unshift(like());
      }

      return {
        ...agent,
        assistantMessage: {
          ...agent.assistantMessage,
          scores,
        },
      }
    })
  }
}
