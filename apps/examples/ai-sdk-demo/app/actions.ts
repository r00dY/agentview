"use server";

import { AgentView } from "agentview";

const av = new AgentView({
  env: "dev:admin@acme.com",
  apiKey: process.env.AGENTVIEW_API_KEY,
});

export async function createSessionAction() {
  const user = await av.createUser();
  const session = await av.createSession({
    agent: "weather-chat",
    userId: user.id,
  });

  return {
    sessionId: session.id,
    userToken: user.token,
  };
}
