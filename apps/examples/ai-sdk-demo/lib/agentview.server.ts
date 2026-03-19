import { AgentView } from "agentview";

export const avServer = new AgentView({
  apiKey: process.env.AGENTVIEW_API_KEY!,
  env: process.env.NEXT_PUBLIC_AGENTVIEW_ENV!,
});