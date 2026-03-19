import { AgentView } from "agentview";
import { cookies } from "next/headers";
import { ChatUI } from "./chat";

const av = new AgentView({
  env: "dev:admin@acme.com",
  apiKey: process.env.AGENTVIEW_API_KEY,
});

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const userToken = cookieStore.get("av-user-token")?.value;

  if (!userToken) {
    return (
      <div style={{ padding: "2rem", color: "#888" }}>
        No user token found. <a href="/" style={{ color: "#4a6cf7" }}>Go back</a>
      </div>
    );
  }

  const session = await av.as(userToken).getSession({ id });

  console.log('session', session);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        maxWidth: 600,
        margin: "0 auto",
        padding: "2rem 1rem",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ marginBottom: "1.5rem", fontSize: "1.25rem" }}>
        AI SDK Demo
      </h1>

      <ChatUI
        session={session}
        userToken={userToken}
      />
    </div>
  );
}
