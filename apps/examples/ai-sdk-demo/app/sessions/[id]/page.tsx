import { cookies } from "next/headers";
import { ChatUI } from "./chat";
import { avServer } from "@/lib/agentview.server";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const userToken = cookieStore.get("av-user-token")?.value;

  if (!userToken) {
    throw new Error("No user token found");
  }

  const session = await avServer.as(userToken).getSession({ id });

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
