# AgentView

AgentView is a minimal managed platform for building customer agents. It works under following assumptions:

1. **AI Engineer** (forward deployed) builds an agent for a client (or their own company). Full flexibility, no chains, no frameworks, no unnecessary abstractions. 
2. The only "contract" between platform and "AI code" is AI Stream Protocol from Vercel AI SDK.

Here's what AgentView provides:
- Users API
- Sessions API
- (tbc)


## How it works?

All the AgentView configuration lives in code, in `agentview.config.tsx` file. Let's define the simplest possible config file:

```tsx
import { defineConfig } from "@agentview/studio";

export default defineConfig({
  publicApiKey: process.env.NEXT_PUBLIC_AGENTVIEW_API_KEY!,
  env: process.env.NEXT_PUBLIC_AGENTVIEW_ENV!,
  agents: [
    {
      name: "weather-chat",
      version: "0.0.1",
      url: "http://localhost:3000/api/weather-chat",
    }
  ]
});
```

We defined `weather-chat` agent, with version `0.0.1`, and said it lives in http://localhost:3000/api/weather-chat endpoint. Whenever you make agentview call to start a session, it will make a request to this endpoint to generate response (you own the endpoint). The endpoint should be compatible with AI SDK Stream Protocol - that's the only requirement.

### Environment

In config you must set `env` aka environment. Each device where you run AgentView is an environment. Local work, preview branch or production are different environments. Each config is applied **per environment** so your production or staging never interferes with local work.

Apply this config with:

```npx agentview config push```

Now the environment knows about 