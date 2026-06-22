"use client";

import { useEffect, useRef, useState } from "react";
import { useEveAgent } from "eve/react";
import type { EveMessageData, UseEveAgentOptions } from "eve/react";

const STORAGE_KEY = "eve-hello-conversation";

type EveOptions = UseEveAgentOptions<EveMessageData>;
type Persisted = {
  session?: EveOptions["initialSession"];
  events?: EveOptions["initialEvents"];
};

function loadPersisted(): Persisted | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch {
    return null;
  }
}

export default function ChatPage() {
  // localStorage is only available on the client, and reading it during the
  // initial render would diverge from the server-rendered HTML. Defer mounting
  // the chat (which reads persisted state in the hook's init) until after mount.
  const [ready, setReady] = useState(false);
  const initialRef = useRef<Persisted | null>(null);

  useEffect(() => {
    initialRef.current = loadPersisted();
    setReady(true);
  }, []);

  if (!ready) {
    return (
      <main className="mx-auto flex h-full w-full max-w-2xl flex-1 items-center justify-center px-4">
        <p className="text-sm text-neutral-400">Loading…</p>
      </main>
    );
  }

  return <Chat initial={initialRef.current} />;
}

function Chat({ initial }: { initial: Persisted | null }) {
  const agent = useEveAgent({
    initialSession: initial?.session,
    initialEvents: initial?.events,
  });
  const isBusy = agent.status === "submitted" || agent.status === "streaming";

  const messages = agent.data.messages;
  const scrollRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Persist the conversation whenever the authoritative stream or session
  // cursor changes, so a refresh resumes exactly where we left off.
  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ session: agent.session, events: agent.events }),
      );
    } catch {
      // ignore quota / serialization errors
    }
  }, [agent.events, agent.session]);

  // Keep the latest message in view as the conversation grows.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  function handleClear() {
    agent.reset();
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  return (
    <main className="mx-auto flex h-full w-full max-w-2xl flex-1 flex-col px-4">
      <header className="flex items-center justify-between gap-4 border-b border-neutral-200 py-4 dark:border-neutral-800">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Hello, Eve</h1>
          <p className="text-xs text-neutral-500">Your conversation is saved locally.</p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
            isBusy
              ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
              : agent.status === "error"
                ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400"
                : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
          }`}
        >
          <span className="size-1.5 rounded-full bg-current" />
          {isBusy ? "Thinking" : agent.status === "error" ? "Error" : "Ready"}
        </span>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto py-6">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-center text-sm text-neutral-400">
              Start the conversation by sending a message below.
            </p>
          </div>
        ) : (
          messages.map((message) => {
            const isUser = message.role === "user";
            return (
              <article
                key={message.id}
                className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}
              >
                <span className="px-1 text-xs font-medium uppercase tracking-wide text-neutral-400">
                  {message.role}
                </span>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    isUser
                      ? "rounded-br-md bg-blue-600 text-white"
                      : "rounded-bl-md bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                  }`}
                >
                  {message.parts.map((part, index) =>
                    part.type === "text" ? <span key={index}>{part.text}</span> : null,
                  )}
                </div>
              </article>
            );
          })
        )}
        {agent.error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-400">
            {agent.error.message}
          </p>
        ) : null}
      </div>

      <div className="border-t border-neutral-200 py-4 dark:border-neutral-800">
        <form
          ref={formRef}
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const message = String(form.get("message") ?? "").trim();
            if (message.length > 0) {
              void agent.send({ message });
              formRef.current?.reset();
            }
          }}
        >
          <input
            name="message"
            autoComplete="off"
            placeholder="Type a message…"
            disabled={isBusy}
            className="flex-1 rounded-full border border-neutral-300 bg-white px-4 py-2.5 text-sm outline-none transition placeholder:text-neutral-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button
            type="submit"
            disabled={isBusy}
            className="rounded-full bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        </form>
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={handleClear}
            disabled={isBusy || messages.length === 0}
            className="text-xs font-medium text-neutral-500 underline-offset-2 transition hover:text-red-600 hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:no-underline"
          >
            Clear conversation
          </button>
        </div>
      </div>
    </main>
  );
}
