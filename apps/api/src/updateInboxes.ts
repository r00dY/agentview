import { commentMessages, events } from "./schemas/schema";
import { eq, type InferSelectModel, sql } from "drizzle-orm";
import type { SessionItem, Session } from "agentview/apiTypes";
import { inboxItems } from "./schemas/schema";
import { members } from "./schemas/auth-schema";
import type { Transaction } from "./types";
import { isInboxItemUnread } from "./inboxItems";
import { resolveTarget, targetFilter, type Target } from "./target";
import { db__dangerous } from "./db";

/**
 * This function is "MVP" and is far from perfect.
 *
//  * Problems:
 * 1. It takes transaction as parameter which should not be required. It should be indempotent and retriable.
 * 2. It takes `event` as a parameter, but actually it should just find the inboxes to be updated (based on last_event_id) and update them.
 *
 * However, for now the project is small, number of users will be small too. So we can just do it a bit differently:
 * 1. We use the same transaction as the operation + event add. This provides confidence, the state of the system must be correct. If there's error, comment and event are not added too.
 * 2. Thanks to the 1., we can always just call this function with new event. There's no chance previous events fucked sth up.
 *
 * How this should work:
 * - operation & adding event are done in the same transaction, but then transaction is closed. If successful, event goes to the queue.
 * - events are processed in order one by one.
 * - next event is processed only after the previous one is successful.
 *
 */

type EventType = InferSelectModel<typeof events> & { payload: any }

export interface InboxContext {
    session: Session;
    item: SessionItem | null;
    runId: string | null;
    channelMessageId: string | null;
}

export async function updateInboxes(
    tx: Transaction,
    newEvent: EventType,
) {
    let target : Target;

    if (newEvent.type === 'session_created') {
        target = await resolveTarget(tx, { sessionId: newEvent.payload.session_id });
    }
    else if (newEvent.type === 'comment_created' || newEvent.type === 'comment_edited' || newEvent.type === 'comment_deleted') {
        const commentId = newEvent.payload.comment_id;

        const comment = await tx.query.commentMessages.findFirst({
            where: eq(commentMessages.id, commentId)
        });
        
        if (!comment) {
            throw new Error("[Internal Error] Comment not found");
        }

        target = await resolveTarget(tx, {
            sessionId: comment.sessionId ?? undefined,
            runId: comment.runId ?? undefined,
            sessionItemId: comment.sessionItemId ?? undefined,
            channelMessageId: comment.channelMessageId ?? undefined,
        });
    }
    else {
        throw new Error(`Incorrect event type: "${newEvent.type}"`);
    }

    // Get all members of the organization
    // members table, users table etc are not under RLS, so we use db__dangerous
    const orgMembers = await db__dangerous.query.members.findMany({
        where: eq(members.organizationId, newEvent.organizationId),
        with: {
            users: {
                with: {
                    inboxItems: {
                        where: targetFilter(inboxItems, target),
                    }
                }
            }
        }
    });

    const allUsers = orgMembers.map(m => m.users);




    const newInboxItemValues: any[] = [];

    for (const user of allUsers) {
        if (user.inboxItems.length > 1) {
            throw new Error("[Internal Error] User has more than one inbox item");
        }

        const inboxItem = user.inboxItems.length === 0 ? null : user.inboxItems[0];

        if (!isEventForUser(newEvent, user.id)) {
            continue;
        }

        if (newEvent.type === 'session_created') {
            if (inboxItem) {
                throw new Error("[Internal Error] `session_created` event encountered inbox item for this session, shouldn't happen");
            }

            newInboxItemValues.push({
                organizationId: newEvent.organizationId,
                userId: user.id,
                sessionId: newEvent.payload.session_id,
                lastNotifiableEventId: newEvent.id,
                render: {
                    events: [newEvent]
                }
            });
        }
        else if (newEvent.type === 'comment_created') {
            if (!inboxItem) {
                newInboxItemValues.push({
                    organizationId: newEvent.organizationId,
                    userId: user.id,
                    ...target.ids,
                    lastNotifiableEventId: newEvent.id,
                    render: {
                        events: [newEvent]
                    }
                });
            } else {
                const isUnread = isInboxItemUnread(inboxItem);
                const prevRender = inboxItem.render as { events: EventType[] };

                newInboxItemValues.push({
                    ...inboxItem,
                    lastNotifiableEventId: newEvent.id,
                    render: {
                        ...prevRender,
                        events: isUnread ? [...prevRender.events, newEvent] : [newEvent]
                    }
                });
            }
        }
        else if (newEvent.type === 'comment_edited') {
            if (!inboxItem) {
                continue; // error state: ignore. Inbox item should exist.
            }

            const prevRender = inboxItem.render as { events: EventType[] };
            const events = [...prevRender.events];

            const index = events.findIndex((event) => event.payload.comment_id === newEvent.payload.comment_id);
            if (index === -1) {
                continue; // if edited comment_id doesn't exist in current inbox state, just do nothing.
            }

            events[index] = newEvent;

            newInboxItemValues.push({
                ...inboxItem,
                // We don't have to set lastNotifiableEventId. Edits are not notifiable events. They'll just silently update the state of the inbox item.
                render: {
                    ...prevRender,
                    events
                }
            });
        }
        else if (newEvent.type === 'comment_deleted') {
            if (!inboxItem) {
                continue; // error state: ignore. Inbox item should exist.
            }

            const prevRender = inboxItem.render as { events: EventType[] };
            const events = prevRender.events.filter((event) => event.payload.comment_id !== newEvent.payload.comment_id);

            if (events.length === prevRender.events.length) {
                continue; // if deleted comment_id doesn't exist in current inbox state, just do nothing. Non-notifiable event.
            }

            const newInboxItem = {
                ...inboxItem,
                // do not set lastNotifiableEventId. Deletes are not notifiable events.
                render: {
                    ...prevRender,
                    events
                }
            }

            // If this event zeros inbox item, then we must revert the last notifiable event to last read event id (otherwise it will be counted as "unread")
            // We should not change lastReadEventId as it's information about time when user last time saw the inbox item. It's an event that "counts" as important system information (non derived).
            if (events.length === 0) {
                newInboxItem.lastNotifiableEventId = inboxItem.lastReadEventId ?? inboxItem.lastNotifiableEventId
            }

            newInboxItemValues.push(newInboxItem);
        }
        else {
            throw new Error(`Incorrect event type: "${newEvent.type}"`);
        }
    }

    if (newInboxItemValues.length > 0) {
        await tx.insert(inboxItems).values(newInboxItemValues).onConflictDoUpdate({
            target: [inboxItems.userId, inboxItems.sessionId, inboxItems.runId, inboxItems.sessionItemId, inboxItems.channelMessageId],
            set: {
                updatedAt: new Date().toISOString(),
                lastNotifiableEventId: sql.raw(`excluded.${inboxItems.lastNotifiableEventId.name}`),
                render: sql.raw(`excluded.${inboxItems.render.name}`),
            }
        });
    }
}

function isEventForUser(event: InferSelectModel<typeof events>, userId: string) {
    if (event.authorId === userId) {
        return false
    }

    return true;
}
