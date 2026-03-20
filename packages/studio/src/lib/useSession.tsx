import { getLastRun } from "agentview/sessionUtils";
import { useEffect, useRef, useState } from "react";
import { agentview } from "./agentview";
import { invalidateCache } from "./swr-cache";
import type { StandardSession } from "agentview/apiTypes";
import { useRerender } from "../hooks/useRerender";


export function useSession(
    externalSession: StandardSession,
): { session: StandardSession, createRun: (input: any) => Promise<void>, cancelRun: () => Promise<void>, isRunning: boolean } {
    const [localSession, setLocalSession] = useState<StandardSession | undefined>(undefined);

    const activeSession = localSession ?? externalSession; // localSession overrides externalSession EVEN IF isWatching is false! This is by design.
    const lastRun = getLastRun(activeSession);

    const abortControllerRef = useRef<AbortController | undefined>(undefined); // this is also a lock, if defined -> watch is in progress

    useEffect(() => {
        return () => {
            abortControllerRef.current?.abort(); // abort watch if exists on unmount
        }
    }, [])

    const rerender = useRerender();

    const [isRunBeingCreated, setIsRunBeingCreated] = useState(false);

    async function startWatching() {
        if (abortControllerRef.current !== undefined) { // is streaming?
            return;
        }

        abortControllerRef.current = new AbortController();

        try {
            console.log("[useSession] starting watch for session", externalSession.id);

            const stream = await agentview.getSessionStream({
                id: externalSession.id,
                signal: abortControllerRef.current!.signal,
            });

            if (stream) {
                console.log("[useSession] stream started for session", externalSession.id);
                for await (const { session, event } of stream) {
                    console.log("[useSession] event", event.type, event.data);
                    setLocalSession(session as StandardSession);
                    invalidateCache(`session:${session.id}`) // this could be direct *update* of cache.
                }
            }

        } catch (err: any) {
            if (err?.name === 'AbortError') {
                return;
            };
            console.error("[useSession] error watching session", err);
        } finally {
            console.log("[useSession] stopping watch for session", externalSession.id);
            abortControllerRef.current = undefined;
            rerender();
        }
    }

    useEffect(() => {
        if (abortControllerRef.current !== undefined) { // is streaming?
            return;
        }

        if (lastRun?.status === "in_progress") {
            startWatching();
        }
        else {
            if (localSession) { // if not watching
                const localSessionLastActivityAt = getLastActivityAt(localSession);
                const externalSessionLastActivityAt = getLastActivityAt(externalSession);
                if (localSessionLastActivityAt <= externalSessionLastActivityAt) {
                    setLocalSession(undefined);
                }
            }
        }
    })

    const createRun = async (input: any) => {
        try {
            setIsRunBeingCreated(true);
            await agentview.createRun({ sessionId: externalSession.id, input });
            startWatching();

        } finally {
            setIsRunBeingCreated(false);
        };
    }

    const cancelRun = async () => {
        if (lastRun?.status === 'in_progress') {
            await agentview.cancelRun({ sessionId: activeSession.id });
        }
    };

    return { session: activeSession, createRun, cancelRun, isRunning: isRunBeingCreated || lastRun?.status === 'in_progress' || abortControllerRef.current !== undefined };
}


function getLastActivityAt(session: StandardSession): Date {
    let lastUpdatedAt = new Date(session.updatedAt);

    const lastRun = getLastRun(session);
    if (lastRun) {
        const lastRunUpdatedAt = new Date(lastRun.updatedAt);
        if (lastRunUpdatedAt > lastUpdatedAt) {
            lastUpdatedAt = lastRunUpdatedAt;
        }
    }

    return lastUpdatedAt;
}
