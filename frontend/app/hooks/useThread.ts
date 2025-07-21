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

//   // Add activity with streaming
//   const addActivity = useCallback(
//     async (input: { type: string; role: string; content: any }) => {
//       if (!threadRef.current) return;
//       return new Promise<void>((resolve, reject) => {
//         const es = new EventSource(`http://localhost:2138/threads/${threadId}/activities/stream?${new URLSearchParams({ stream: 'true' })}`, { withCredentials: false });
//         let done = false;

//         // Send the POST request to start the stream
//         fetch(`http://localhost:2138/threads/${threadId}/activities`, {
//           method: 'POST',
//           headers: { 'Content-Type': 'application/json' },
//           body: JSON.stringify({ stream: true, input }),
//         }).catch((err) => {
//           es.close();
//           setInternal((prev) => ({ state: 'error', error: err, thread: null }));
//           reject(err);
//         });

//         es.onmessage = (event) => {
//           // Default event (shouldn't be used, but just in case)
//           try {
//             const data = JSON.parse(event.data);
//             // Fallback: treat as activity
//             updateThreadWithActivity(data);
//           } catch {}
//         };
//         es.addEventListener('activity', (event: MessageEvent) => {
//           try {
//             const activity: Activity = JSON.parse(event.data);
//             updateThreadWithActivity(activity);
//           } catch {}
//         });
//         es.addEventListener('thread.state', (event: MessageEvent) => {
//           try {
//             const { state } = JSON.parse(event.data);
//             updateThreadState(state);
//           } catch {}
//         });
//         es.onerror = (err) => {
//           if (!done) {
//             es.close();
//             setInternal((prev) => ({ state: 'error', error: err, thread: null }));
//             reject(err);
//           }
//         };
//         es.addEventListener('end', () => {
//           done = true;
//           es.close();
//           resolve();
//         });

//         function updateThreadWithActivity(activity: Activity) {
//           setInternal((prev) => {
//             if (prev.state !== 'success' || !prev.thread) return prev;
//             // Avoid duplicates
//             if (prev.thread.activities.some((a) => a.id === activity.id)) return prev;
//             const updated = { ...prev.thread, activities: [...prev.thread.activities, activity] };
//             threadRef.current = updated;
//             return { ...prev, thread: updated };
//           });
//         }
//         function updateThreadState(state: string) {
//           setInternal((prev) => {
//             if (prev.state !== 'success' || !prev.thread) return prev;
//             const updated = { ...prev.thread, state };
//             threadRef.current = updated;
//             return { ...prev, thread: updated };
//           });
//         }
//       });
//     },
//     [threadId]
//   );

  return { ...internal, addActivity: () => {} };
} 