import { and, eq, isNull } from "drizzle-orm";
import { channelMessages, runs, sessionItems } from "./schemas/schema";
import type { Transaction } from "./types";
import { AgentViewError, type ChannelMessage, type SessionItem, type StandardRun, type StandardSession, type InputTarget } from "agentview";
import { fetchSession } from "./sessions";

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

/** Build a drizzle where filter matching target columns on any table with the standard target columns */
export function targetFilter(
    table: { sessionId: any; runId: any; sessionItemId: any; channelMessageId: any },
    target: Target,
) {
    switch (target.type) {
        case 'session':
            return and(
                eq(table.sessionId, target.ids.sessionId),
                isNull(table.runId),
                isNull(table.sessionItemId),
                isNull(table.channelMessageId),
            );
        case 'run':
            return and(
                eq(table.sessionId, target.ids.sessionId),
                eq(table.runId, target.ids.runId),
                isNull(table.sessionItemId),
                isNull(table.channelMessageId),
            );
        case 'sessionItem':
            return and(
                eq(table.sessionId, target.ids.sessionId),
                eq(table.runId, target.ids.runId),
                eq(table.sessionItemId, target.ids.sessionItemId),
                isNull(table.channelMessageId),
            );
        case 'channelMessage':
            return and(
                eq(table.sessionId, target.ids.sessionId),
                eq(table.runId, target.ids.runId),
                isNull(table.sessionItemId),
                eq(table.channelMessageId, target.ids.channelMessageId),
            );
    }
}

/** Derive the session + item + runId + channelMessageId from a comment target for inbox updates */
export async function resolveTarget(tx: Transaction, target: InputTarget): Promise<Target> {

    if (typeof target.sessionItemId === 'string') {
        const sessionItem = await tx.query.sessionItems.findFirst({
            where: eq(sessionItems.id, target.sessionItemId),
        });

        if (!sessionItem) {
            throw new AgentViewError("Session item not found", 404);
        }

        if (target.sessionId && sessionItem.sessionId !== target.sessionId) {
            throw new AgentViewError("Session item does not belong to the session", 400);
        }

        if (target.runId && sessionItem.runId !== target.runId) {
            throw new AgentViewError("Session item does not belong to the run", 400);
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
            with: {
                run: true,
            },
        });

        if (!channelMessage) {
            throw new AgentViewError("Channel message not found", 404);
        }

        if (!channelMessage.run) {
            throw new AgentViewError("Channel message has no run id", 400);
        }

        if (target.sessionId && channelMessage.run.sessionId !== target.sessionId) {
            throw new AgentViewError("Session item does not belong to the session", 400);
        }

        if (target.runId && channelMessage.run.id !== target.runId) {
            throw new AgentViewError("Session item does not belong to the run", 400);
        }

        const { ids: { sessionId } } = await resolveTarget(tx, { runId: channelMessage.runId ?? undefined });

        return {
            type: 'channelMessage',
            ids: {
                sessionId,
                runId: channelMessage.run.id,
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

        if (target.sessionId && run.sessionId !== target.sessionId) {
            throw new AgentViewError("Run does not belong to the session", 400);
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
    session: StandardSession;
}

export type RunTargetWithObjects = RunTarget & {
    session: StandardSession;
    run: StandardRun;
}

export type ChannelMessageTargetWithObjects = ChannelMessageTarget & {
    session: StandardSession;
    run: StandardRun;
    channelMessage: ChannelMessage;
}

export type SessionItemTargetWithObjects = SessionItemTarget & {
    session: StandardSession;
    run: StandardRun;
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
