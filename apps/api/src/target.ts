import { eq } from "drizzle-orm";
import { channelMessages, runs, sessionItems } from "./schemas/schema";
import type { Transaction } from "./types";
import { AgentViewError, type ChannelMessage, type SessionItem, type Run, type Session } from "agentview";
import { fetchSession } from "./sessions";

export type InputTarget = {
    sessionId?: string | null;
    runId?: string | null;
    channelMessageId?: string | null;
    sessionItemId?: string | null;
}

export type SessionTarget = {
    type: 'session',
    ids: {
        sessionId: string;
    }
}

export type RunTarget = {
    type: 'run',
    ids: {
        sessionId: string;
        runId: string;
    }
}

export type ChannelMessageTarget = {
    type: 'channelMessage',
    ids: {
        sessionId: string;
        runId: string;
        channelMessageId: string;
    }
}

export type SessionItemTarget = {
    type: 'sessionItem',
    ids: {
        sessionId: string;
        runId: string;
        sessionItemId: string;
    }
}

export type Target = SessionTarget | RunTarget | ChannelMessageTarget | SessionItemTarget;



/** Derive the session + item + runId + channelMessageId from a comment target for inbox updates */
export async function resolveTarget(tx: Transaction, target: InputTarget): Promise<Target> {

    // Check that exactly one of sessionId, runId, channelMessageId, sessionItemId is set (not null or undefined)
    const keys = ['sessionId', 'runId', 'channelMessageId', 'sessionItemId'] as const;
    const setKeys = keys.filter(k => typeof target[k] === 'string');
    if (setKeys.length !== 1) {
        throw new AgentViewError("[resolveTarget] Exactly one of sessionId, runId, channelMessageId or sessionItemId must be provided", 400);
    }


    if (typeof target.sessionItemId === 'string') {
        const sessionItem = await tx.query.sessionItems.findFirst({
            where: eq(sessionItems.id, target.sessionItemId),
        });

        if (!sessionItem) {
            throw new AgentViewError("Session item not found", 404);
        }

        return {
            type: 'sessionItem',
            ids: {
                sessionId: sessionItem.sessionId,
                runId: sessionItem.runId,
                sessionItemId: sessionItem.id,
            }
        };
    }
    else if (typeof target.channelMessageId === 'string') {
        const channelMessage = await tx.query.channelMessages.findFirst({
            where: eq(channelMessages.id, target.channelMessageId),
        });

        if (!channelMessage) {
            throw new AgentViewError("Channel message not found", 404);
        }

        if (!channelMessage.runId) {
            throw new AgentViewError("Channel message has no run id", 400);
        }

        const { ids: { sessionId } } = await resolveTarget(tx, { runId: channelMessage.runId });

        return {
            type: 'channelMessage',
            ids: {
                sessionId,
                runId: channelMessage.runId,
                channelMessageId: channelMessage.id,
            }
        };
    }
    else if (typeof target.runId === 'string') {
        const run = await tx.query.runs.findFirst({
            where: eq(runs.id, target.runId),
        });
        if (!run) {
            throw new AgentViewError("Run not found", 404);
        }
        return {
            type: 'run',
            ids: {
                sessionId: run.sessionId,
                runId: run.id,
            }
        };
    }
    else if (typeof target.sessionId === 'string') {
        return {
            type: 'session',
            ids: {
                sessionId: target.sessionId,
            }
        };
    }
    else {
        throw new AgentViewError("Invalid target", 400);
    }
}

// ids 

export type SessionTargetWithObjects = SessionTarget & {
    session: Session;
}

export type RunTargetWithObjects = RunTarget & {
    session: Session;
    run: Run;
}

export type ChannelMessageTargetWithObjects = ChannelMessageTarget & {
    session: Session;
    run: Run;
    channelMessage: ChannelMessage;
}

export type SessionItemTargetWithObjects = SessionItemTarget & {
    session: Session;
    run: Run;
    sessionItem: SessionItem;
}

export type TargetWithObjects = SessionTargetWithObjects | RunTargetWithObjects | ChannelMessageTargetWithObjects | SessionItemTargetWithObjects;

export async function resolveTargetWithObjects(tx: Transaction, inputTarget: InputTarget): Promise<TargetWithObjects> {
    const target = await resolveTarget(tx, inputTarget); 
    const session = await fetchSession(tx, target.ids.sessionId);

    if (!session) {
        throw new AgentViewError("Session not found", 404);
    }

    if (target.type === 'session') {
        return {
            ...target,
            session,
        };
    }

    const run = session.runs.find(r => r.id === target.ids.runId);
    if (!run) {
        throw new AgentViewError("Run not found", 404);
    }


    if (target.type === 'run') {
        return {
            ...target,
            session,
            run,
        };
    }

    if (target.type === 'channelMessage') {
        const channelMessage = run.channelMessages.find(c => c.id === target.ids.channelMessageId);
        if (!channelMessage) {
            throw new AgentViewError("Channel message not found", 404);
        }
        return {
            ...target,
            session,
            run,
            channelMessage,
        };
    }

    if (target.type === 'sessionItem') {
        const sessionItem = run.sessionItems.find(i => i.id === target.ids.sessionItemId);
        if (!sessionItem) {
            throw new AgentViewError("Session item not found", 404);
        }
        return {
            ...target,
            session,
            run,
            sessionItem,
        }
    }

    throw new AgentViewError("Invalid target", 400);
}
