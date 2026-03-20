"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createUserToken, getUserToken, client } from "@/lib/agentview.client";
import { AgentViewError } from "agentview";

export default function Home() {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    setIsLoading(true);
    setError(null);

    let userToken = await getUserToken();
    if (!userToken) {
      userToken = await createUserToken();
    }

    try {
      const session = await client.as(userToken).createSession({
        agent: "weather-chat",
        input: {
          role: "user",
          parts: [{ type: "text", text: input.trim() }],
        },
      });

      router.push(`/sessions/${session.id}`);

    } catch (error: unknown) {
      if (error instanceof AgentViewError) {
        setError(error.message);
      } else {
        setError(error instanceof Error ? error.message : "Failed to create session");
      }
      setIsLoading(false);
    }
  };

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

      {error && (
        <div
          style={{
            color: "#f87171",
            padding: "0.75rem",
            marginBottom: "1rem",
            borderRadius: 8,
            background: "#2e1a1a",
            border: "1px solid #5e3a3a",
          }}
        >
          {error}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", gap: "0.5rem" }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isLoading}
          placeholder="Ask about the weather..."
          style={{
            flex: 1,
            padding: "0.75rem",
            borderRadius: 8,
            border: "1px solid #333",
            background: "#222",
            color: "#eee",
            fontSize: "1rem",
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          style={{
            padding: "0.75rem 1.25rem",
            borderRadius: 8,
            border: "none",
            background: "#4a6cf7",
            color: "white",
            fontSize: "1rem",
            cursor: "pointer",
          }}
        >
          {isLoading ? "Creating..." : "Send"}
        </button>
      </form>
    </div>
  );
}
