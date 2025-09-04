import { events } from "./db/schema";
import { inArray, type InferSelectModel, sql } from "drizzle-orm";
import type { Activity, Thread } from "./shared/apiTypes";
import { db } from "./db";
import { inboxItems } from "./db/schema";
import { getLastEvent } from "./events";
import type { Transaction } from "./types";

/**
 * This function is "MVP" and is far from perfect.
 * 
 * Problems:
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
export async function updateInboxes(
    tx: Transaction,
    event: InferSelectModel<typeof events> & { payload: any },
    thread: Thread,
    activity: Activity | null,
) {
    if (!['comment_created', 'comment_edited', 'comment_deleted', 'thread_created'].includes(event.type)) {
        throw new Error(`Incorrect event type: "${event.type}"`);
    }

    console.log("updateInboxes", event.type);
    console.log("thread", thread);
    console.log("activity", activity);

    const allUsers = await tx.query.users.findMany({
        with: {
            inboxItems: {
                // where: ((inboxItems, { eq }) => eq(inboxItems.activityId, activity?.id ?? null)),
                where: ((inboxItems, { eq, and, isNull }) => activity ? eq(inboxItems.activityId, activity.id) : and(eq(inboxItems.threadId, thread.id), isNull(inboxItems.activityId))),
            }
        }
    });

    // const eventPayload: any = event.payload;

    const newInboxItemValues: any[] = [];

    for (const user of allUsers) {
        if (user.inboxItems.length > 1) {
            throw new Error("[Internal Error] User has more than one inbox item");
        }

        const inboxItem = user.inboxItems.length === 0 ? null : user.inboxItems[0];

        if (!isEventForUser(event, user.id)) {
            continue;
        }

        if (event.type === 'thread_created') {
            if (inboxItem) {
                throw new Error("[Internal Error] `thread_created` event encountered inbox item for this thread, shouldn't happen");
            }

            newInboxItemValues.push({
                userId: user.id,
                threadId: event.payload.thread_id,
                lastNotifiableEventId: event.id,
                render: {
                    isNew: true,
                    author_id: event.authorId,
                }
            });
        }
        else if (event.type === 'comment_created') {
            if (!activity) {
                throw new Error("Activity is required for comment_created event");
            }


            if (!inboxItem) {
                newInboxItemValues.push({
                    userId: user.id,
                    activityId: activity.id,
                    threadId: activity.thread_id,
                    lastNotifiableEventId: event.id,
                    render: {
                        items: [eventToItem(event)]
                    }
                });
            } else {
                const isRead = inboxItem.lastNotifiableEventId <= (inboxItem.lastReadEventId ?? 0);
                const prevRender = inboxItem.render as any;

                newInboxItemValues.push({
                    ...inboxItem,
                    lastNotifiableEventId: event.id,
                    render: {
                        ...prevRender,
                        items: isRead ? [eventToItem(event)] : [...prevRender.items, eventToItem(event)]
                    }
                });
            }
        }
        else if (event.type === 'comment_edited') {
            if (!inboxItem) {
                continue; // error state: ignore. Inbox item should exist.
            }

            const prevRender = inboxItem.render as any;
            const items = [...prevRender.items];

            const index = items.findIndex((item: any) => item.comment_id === event.payload.comment_id);
            if (index === -1) {
                continue; // if edited comment_id doesn't exist in current inbox state, just do nothing.
            }

            items[index] = eventToItem(event);
            
            newInboxItemValues.push({
                ...inboxItem,
                // We don't have to set lastNotifiableEventId. Edits are not notifiable events. They'll just silently update the state of the inbox item.
                render: {
                    ...prevRender,
                    items
                }
            });
        }
        else if (event.type === 'comment_deleted') {   
            if (!inboxItem) {
                continue; // error state: ignore. Inbox item should exist.
            }

            const prevRender = inboxItem.render as any;
            const items = prevRender.items.filter((item: any) => item.comment_id !== event.payload.comment_id);

            if (items.length === prevRender.items.length) {
                continue; // if deleted comment_id doesn't exist in current inbox state, just do nothing. Non-notifiable event.
            }

            const newInboxItem = {
                ...inboxItem,
                // do not set lastNotifiableEventId. Deletes are not notifiable events.
                render: {
                    ...prevRender,
                    items
                }
            }

            // If this event zeros inbox item, then we must revert the last notifiable event to last read event id (otherwise it will be counted as "unread")
            // We should not change lastReadEventId as it's information about time when user last time saw the inbox item. It's an event that "counts" as important system information (non derived).
            if (items.length === 0) {
                newInboxItem.lastNotifiableEventId = inboxItem.lastReadEventId ?? inboxItem.lastNotifiableEventId
            }

            newInboxItemValues.push(newInboxItem);
        }
        else {
            throw new Error(`Incorrect event type: "${event.type}"`);
        }

    }

    if (newInboxItemValues.length > 0) {
        await tx.insert(inboxItems).values(newInboxItemValues).onConflictDoUpdate({
            target: [inboxItems.userId, inboxItems.activityId],
            set: {
                updatedAt: new Date(),
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

function eventToItem(event: InferSelectModel<typeof events>) {
    if (typeof event.payload !== 'object') {
        throw new Error("[Internal Error] Event payload is not an object");
    }

    return {
        ...event.payload,
        author_id: event.authorId,
    }
}