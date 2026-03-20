import { createClient } from "agentview";

export const avServer = createClient({
  apiKey: process.env.AGENTVIEW_API_KEY!,
  env: process.env.NEXT_PUBLIC_AGENTVIEW_ENV!,
});