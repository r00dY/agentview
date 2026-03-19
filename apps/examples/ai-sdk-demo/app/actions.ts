"use server";

import { AgentView, AgentViewError } from "agentview";
import { cookies } from "next/headers";

const av = new AgentView({
  env: "dev:admin@acme.com",
  apiKey: process.env.AGENTVIEW_API_KEY,
});

async function getOrCreateUser(): Promise<{ id: string; token: string }> {
  const cookieStore = await cookies();
  const token = cookieStore.get("av-user-token")?.value;
  const userId = cookieStore.get("av-user-id")?.value;

  if (token && userId) {
    return { id: userId, token };
  }

  const user = await av.createUser();
  cookieStore.set("av-user-token", user.token, { path: "/" });
  cookieStore.set("av-user-id", user.id, { path: "/" });
  return { id: user.id, token: user.token };
}

export async function startSessionAction(
  message: string
): Promise<{ sessionId: string } | { error: string }> {
  try {
    const user = await getOrCreateUser();

    console.log("user", user);

    const session = await av.createSession({
      agent: "weather-chat",
      userId: user.id,
      input: {
        role: "user",
        parts: [{ type: "text", text: message }],
      }
    });

    console.log("session created", session.id);

    // const run = await av.createRun({
    //   sessionId: session.id,
    //   input: {
    //     role: "user",
    //     parts: [{ type: "text", text: message }],
    //   }
    // });

    // console.log("run created", run.id);

    return { sessionId: session.id };
  } catch (error: unknown) {
    if (error instanceof AgentViewError) {
      console.error(error.toString());
      return { error: error.toString() };
    }
    return { error: error instanceof Error ? error.message : "Failed to create session" };
  }
}

export async function getSessionData(sessionId: string) {
  const session = await av.getSession({ id: sessionId });
  return {
    id: session.id,
    messages: session.messages ?? [],
  };
}
