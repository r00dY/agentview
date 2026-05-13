import { like } from "./scores";
import type { AgentViewConfig } from "./types";

export function defineConfig(config: AgentViewConfig): AgentViewConfig {
  const newConfig = {
    ...config,
    agents: config.agents?.map((agent) => {

      const scores = [...(agent.run?.scores ?? [])];
      if (!agent.run?.disableLike) {
        scores.unshift(like());
      }

      return {
        ...agent,
        run: {
          ...agent.run,
          scores,
        },
        channels: agent.channels?.map((channel) => {
          if (channel.type === 'resend') {
            return {
              ...channel,
              address: ""
            }
          }
          return channel;
        }),
      }
    })
  }
  return newConfig;
}
