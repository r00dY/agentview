"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import { useState } from "react";

export default function Chat() {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });
  const [input, setInput] = useState("");

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

      <div style={{ flex: 1, overflowY: "auto", marginBottom: "1rem" }}>
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              marginBottom: "1rem",
              padding: "0.75rem",
              borderRadius: 8,
              background: m.role === "user" ? "#222" : "#1a1a2e",
            }}
          >
            <div
              style={{
                fontSize: "0.75rem",
                color: "#888",
                marginBottom: "0.25rem",
              }}
            >
              {m.role === "user" ? "You" : "Assistant"}
            </div>
            <div style={{ whiteSpace: "pre-wrap" }}>
              {m.parts.map((part, i) => {
                if (part.type === "text") {
                  return <span key={i}>{part.text}</span>;
                }
                if (part.type === "reasoning") {
                  return (
                    <details
                      key={i}
                      style={{
                        margin: "0.5rem 0",
                        padding: "0.5rem",
                        borderRadius: 6,
                        background: "#2a1a3e",
                        border: "1px solid #4a3a5e",
                      }}
                    >
                      <summary
                        style={{
                          cursor: "pointer",
                          fontSize: "0.8rem",
                          color: "#b89adb",
                        }}
                      >
                        Reasoning
                      </summary>
                      <div
                        style={{
                          marginTop: "0.25rem",
                          fontSize: "0.85rem",
                          color: "#c8b8e8",
                        }}
                      >
                        {part.text}
                      </div>
                    </details>
                  );
                }
                if (isToolUIPart(part)) {
                  const toolName =
                    part.type === "dynamic-tool"
                      ? part.toolName
                      : part.type.replace("tool-", "");
                  return (
                    <div
                      key={i}
                      style={{
                        margin: "0.5rem 0",
                        padding: "0.5rem",
                        borderRadius: 6,
                        background: "#1a2e1a",
                        border: "1px solid #3a5e3a",
                        fontSize: "0.85rem",
                      }}
                    >
                      <div
                        style={{ color: "#8ab88a", marginBottom: "0.25rem" }}
                      >
                        Tool: {toolName}
                      </div>
                      {(part.state === "input-available" ||
                        part.state === "output-available") && (
                        <div style={{ color: "#aaa", fontSize: "0.8rem" }}>
                          Input: {JSON.stringify(part.input)}
                        </div>
                      )}
                      {part.state === "output-available" && (
                        <div
                          style={{
                            color: "#cdc",
                            marginTop: "0.25rem",
                            fontSize: "0.8rem",
                          }}
                        >
                          Result: {JSON.stringify(part.output)}
                        </div>
                      )}
                      {part.state === "input-streaming" && (
                        <div style={{ color: "#888", fontSize: "0.8rem" }}>
                          Loading...
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              })}
            </div>
          </div>
        ))}
        {(status === "submitted" || status === "streaming") && (
          <div style={{ color: "#666", padding: "0.5rem" }}>
            {status === "submitted" ? "Thinking..." : "Streaming..."}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) {
            sendMessage({ text: input });
            setInput("");
          }
        }}
        style={{ display: "flex", gap: "0.5rem" }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={status !== "ready"}
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
          disabled={status !== "ready"}
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
          Send
        </button>
      </form>
    </div>
  );
}
