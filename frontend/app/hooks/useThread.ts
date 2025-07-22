import { useCallback, useEffect, useRef, useState } from 'react';

// Types inferred from backend/api.ts and frontend usage
export interface Activity {
  id: string;
  created_at: string;
  updated_at: string;
  content: any;
  thread_id: string;
  type: string;
  role: string;
}

export interface Thread {
  id: string;
  created_at: string;
  updated_at: string;
  metadata: any;
  client_id: string;
  type: string;
  activities: Activity[];
  state: string;
}

type UseThreadState =
  | { state: 'loading'; error: null; thread: null }
  | { state: 'error'; error: any; thread: null }
  | { state: 'success'; error: null; thread: Thread };

export function useThread(threadId: string) {
  const [internal, setInternal] = useState<UseThreadState>({ state: 'loading', error: null, thread: null });
  const threadRef = useRef<Thread | null>(null);

  // Fetch initial thread
  useEffect(() => {
    let cancelled = false;
    setInternal({ state: 'loading', error: null, thread: null });
    fetch(`http://localhost:2138/threads/${threadId}`)
      .then(async (res) => {
        const payload = await res.json();
        if (!res.ok) throw payload?.error || 'Failed to fetch thread';
        return payload.data;
      })
      .then((thread: Thread) => {
        if (!cancelled) {
          threadRef.current = thread;
          setInternal({ state: 'success', error: null, thread });
        }
      })
      .catch((err) => {
        if (!cancelled) setInternal({ state: 'error', error: err, thread: null });
      });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  // Add activity with streaming
  const addActivity = useCallback(
    async (input: { type: string; role: string; content: any }) => {
      if (!threadRef.current) return;
      return new Promise<void>(async (resolve, reject) => {
        let done = false;
        let controller = new AbortController();
        try {
          const response = await fetch(`http://localhost:2138/threads/${threadId}/activities`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stream: true, input }),
            signal: controller.signal,
          });
          if (!response.body) throw new Error('No response body for SSE');
          const reader = response.body.getReader();
          let buffer = '';

          // Helper to parse SSE events
          function parseSSE(chunk: string) {
            const events = chunk.split(/\n(?=data:|event:|id:)/g);
            for (const eventStr of events) {
              let eventType = 'message';
              let data = '';
              for (const line of eventStr.split('\n')) {
                if (line.startsWith('event:')) {
                  eventType = line.replace('event:', '').trim();
                } else if (line.startsWith('data:')) {
                  data += line.replace('data:', '').trim();
                }
              }
              handleEvent(eventType, data);
            }
          }

          function handleEvent(eventType: string, data: string) {
            try {
              if (eventType === 'activity') {
                const activity: Activity = JSON.parse(data);
                updateThreadWithActivity(activity);
              } else if (eventType === 'thread.state') {
                const { state } = JSON.parse(data);
                updateThreadState(state);
              } else if (eventType === 'end') {
                done = true;
                controller.abort();
                resolve();
              } else if (eventType === 'message') {
                // fallback/default
                const parsed = JSON.parse(data);
                updateThreadWithActivity(parsed);
              }
            } catch (err) {
              // ignore parse errors
            }
          }

          while (!done) {
            const { value, done: streamDone } = await reader.read();
            if (streamDone) break;
            buffer += new TextDecoder().decode(value);
            let lastEventIdx = buffer.lastIndexOf('\n\n');
            if (lastEventIdx !== -1) {
              const eventsChunk = buffer.slice(0, lastEventIdx);
              parseSSE(eventsChunk);
              buffer = buffer.slice(lastEventIdx + 2);
            }
          }
        } catch (err) {
          controller.abort();
          setInternal((prev) => ({ state: 'error', error: err, thread: null }));
          reject(err);
        }

        function updateThreadWithActivity(activity: Activity) {
          setInternal((prev) => {
            if (prev.state !== 'success' || !prev.thread) return prev;
            // Avoid duplicates
            if (prev.thread.activities.some((a) => a.id === activity.id)) return prev;
            const updated = { ...prev.thread, activities: [...prev.thread.activities, activity] };
            threadRef.current = updated;
            return { ...prev, thread: updated };
          });
        }
        function updateThreadState(state: string) {
          setInternal((prev) => {
            if (prev.state !== 'success' || !prev.thread) return prev;
            const updated = { ...prev.thread, state };
            threadRef.current = updated;
            return { ...prev, thread: updated };
          });
        }
      });
    },
    [threadId]
  );

  return { ...internal, addActivity };
} 
