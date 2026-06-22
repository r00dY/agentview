"use client";

import { useEveAgent } from "eve/react";
export default function ChatPage() {
  const agent = useEveAgent();
  const isBusy = agent.status === "submitted" || agent.status === "streaming";

  console.log('agent', agent);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const message = String(form.get("message") ?? "").trim();
        if (message.length > 0) {
          void agent.send({ message });
        }
      }}
    >
      {agent.data.messages.map((message) => (
        <article key={message.id}>
          <header>{message.role}</header>
          {message.parts.map((part, index) =>
            part.type === "text" ? <p key={index}>{part.text}</p> : null,
          )}
        </article>
      ))}
      <input name="message" disabled={isBusy} />
      <button disabled={isBusy} type="submit">
        Send
      </button>
    </form>
  );
}