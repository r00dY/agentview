// import { useCallback, useEffect, useRef, useState } from 'react';

// Types inferred from backend/api.ts and frontend usage
// export interface Activity {
//   id: string;
//   created_at: string;
//   updated_at: string;
//   content: any;
//   thread_id: string;
//   type: string;
//   role: string;
// }

// export interface Thread {
//   id: string;
//   created_at: string;
//   updated_at: string;
//   metadata: any;
//   client_id: string;
//   type: string;
//   activities: Activity[];
//   state: string;
// }

// type UseThreadState =
//   | { state: 'loading'; error: null; thread: null }
//   | { state: 'error'; error: any; thread: null }
//   | { state: 'success'; error: null; thread: Thread };



// Async generator to send activity and yield events
export async function* sendActivity(thread_id: string, activity: { type: string; role: string; content: any }) {
  const response = await fetch(`http://localhost:2138/threads/${thread_id}/activities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stream: true, input: activity }),
  });
  if (!response.body) throw new Error('No response body for SSE');
  const reader = response.body.getReader();
  let buffer = '';
  let done = false;

  // Helper to parse SSE events as an async generator
  async function* parseSSE(chunk: string) {
    const eventStrings = chunk.split("\n\n");

    for (const eventStr of eventStrings) {
      let eventType: string | undefined = undefined;
      let data : string = '';

      for (const line of eventStr.split('\n')) {
        if (line.startsWith('event:')) {
          eventType = line.replace('event:', '').trim();
        } else if (line.startsWith('data:')) {
          data += line.replace('data:', '').trim();
        }
      }

      if (eventType && data !== '') {
        yield { event: eventType, data: JSON.parse(data) };
        if (eventType === 'end') {
          done = true;
        }
      }
    }
  }

  while (!done) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buffer += new TextDecoder().decode(value);
    let lastEventIdx = buffer.lastIndexOf('\n\n');
    if (lastEventIdx !== -1) {
      const eventsChunk = buffer.slice(0, lastEventIdx);
      for await (const event of parseSSE(eventsChunk)) {
        yield event;
      }
      buffer = buffer.slice(lastEventIdx + 2);
    }
  }
}



// export function useThread(threadId: string) {
//   const [internal, setInternal] = useState<UseThreadState>({ state: 'loading', error: null, thread: null });
//   const threadRef = useRef<Thread | null>(null);

//   // Fetch initial thread
//   useEffect(() => {
//     let cancelled = false;
//     setInternal({ state: 'loading', error: null, thread: null });
//     fetch(`http://localhost:2138/threads/${threadId}`)
//       .then(async (res) => {
//         const payload = await res.json();
//         if (!res.ok) throw payload?.error || 'Failed to fetch thread';
//         return payload.data;
//       })
//       .then((thread: Thread) => {
//         if (!cancelled) {
//           threadRef.current = thread;
//           setInternal({ state: 'success', error: null, thread });
//         }
//       })
//       .catch((err) => {
//         if (!cancelled) setInternal({ state: 'error', error: err, thread: null });
//       });
//     return () => {
//       cancelled = true;
//     };
//   }, [threadId]);

//   // Add activity using sendActivity async generator
//   const addActivity = useCallback(
//     async (input: { type: string; role: string; content: any }) => {
//       if (!threadRef.current) return;
//       setInternal((prev) => prev.state === 'success' ? { ...prev, thread: { ...prev.thread, state: 'in_progress' } } : prev);
//       try {
//         for await (const event of sendActivity(threadId, input)) {
//           if (event.event === 'activity') {
//             setInternal((prev) => {
//               if (prev.state !== 'success' || !prev.thread) return prev;
//               // Avoid duplicates
//               if (prev.thread.activities.some((a) => a.id === event.data.id)) return prev;
//               const updated = { ...prev.thread, activities: [...prev.thread.activities, event.data] };
//               threadRef.current = updated;
//               return { ...prev, thread: updated };
//             });
//           } else if (event.event === 'thread.state') {
//             setInternal((prev) => {
//               if (prev.state !== 'success' || !prev.thread) return prev;
//               const updated = { ...prev.thread, state: event.data.state };
//               threadRef.current = updated;
//               return { ...prev, thread: updated };
//             });
//           } else if (event.event === 'error') {
//             // Optionally handle error events in UI
//             setInternal((prev) => ({ state: 'error', error: event.data, thread: null }));
//           }
//         }
//       } catch (err) {
//         setInternal((prev) => ({ state: 'error', error: err, thread: null }));
//       }
//     },
//     [threadId]
//   );

//   return { ...internal, addActivity };
// } 
