import { events } from "./db/schema";
import { inArray, type InferSelectModel, sql } from "drizzle-orm";
import type { Activity } from "./shared/apiTypes";
import { db } from "./db";
import { inboxItems } from "./db/schema";
import { getLastEvent } from "./events";

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
export async function updateActivityInboxes(
    tx: Parameters<Parameters<typeof db["transaction"]>[0]>[0],
    activity: Activity,
    event: InferSelectModel<typeof events>
) {
    if (!['comment_created', 'comment_edited', 'comment_deleted'].includes(event.type)) {
        throw new Error(`Incorrect event type: "${event.type}"`);
    }

    const allUsers = await tx.query.users.findMany({
        with: {
            inboxItems: {
                where: ((inboxItems, { eq }) => eq(inboxItems.activityId, activity.id)),
            }
        }
    });

    const eventPayload: any = event.payload;

    const newInboxItemValues: any[] = [];   

    for (const user of allUsers) {
        if (!isEventForUser(event, user.id)) {
            continue;
        }

        const newItem = {
            ...eventPayload,
            author_id: event.authorId,
        }

        const inboxItem = user.inboxItems.length === 0 ? null : user.inboxItems[0];

        if (event.type === 'comment_created') {

            if (!inboxItem) {
                newInboxItemValues.push({
                    userId: user.id,
                    activityId: activity.id,
                    threadId: activity.thread_id,
                    lastNotifiableEventId: event.id,
                    render: {
                        items: [newItem]
                    }
                });
            } else {
                const isRead = inboxItem.lastReadEventId && inboxItem.lastNotifiableEventId <= inboxItem.lastReadEventId;
                const prevRender = inboxItem.render as any;

                newInboxItemValues.push({
                    ...inboxItem,
                    lastNotifiableEventId: event.id,
                    render: {
                        ...prevRender,
                        items: isRead ? [newItem] : [...prevRender.items, newItem]
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

            const index = items.findIndex((item: any) => item.comment_id === newItem.comment_id);
            if (index === -1) {
                continue; // if edited comment_id doesn't exist in current inbox state, just do nothing.
            }

            items[index] = newItem;
            
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
            const items = prevRender.items.filter((item: any) => item.comment_id !== newItem.comment_id);

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

    // if (inboxItemIdsToDelete.length > 0) {
    //     await tx.delete(inboxItems).where(inArray(inboxItems.id, inboxItemIdsToDelete));
    // }

    // if (event.type === 'comment_created') {

    //     const newInboxItemValues: any[] = [];   

    //     for (const user of allUsers) {
    //         if (!isEventForUser(event, user.id)) {
    //             continue;
    //         }

    //         const inboxItem = user.inboxItems.length === 0 ? null : user.inboxItems[0];

    //         if (inboxItem) {
    //             const isRead = !inboxItem.lastReadEventId || inboxItem.lastNotifiableEventId <= inboxItem.lastReadEventId;
    //             const prevRender = inboxItem.render as any;

    //             newInboxItemValues.push({
    //                 ...inboxItem,
    //                 lastNotifiableEventId: event.id,
    //                 render: {
    //                     ...prevRender,
    //                     items: isRead ? [newItem] : [...prevRender.items, newItem]
    //                 }
    //             });
    //         } else {
    //             newInboxItemValues.push({
    //                 userId: user.id,
    //                 activityId: activity.id,
    //                 threadId: activity.thread_id,
    //                 lastNotifiableEventId: event.id,
    //                 render: {
    //                     items: [newItem]
    //                 }
    //             });
    //         }
    //     }

    //     await tx.insert(inboxItems).values(newInboxItemValues).onConflictDoUpdate({
    //         target: [inboxItems.userId, inboxItems.activityId],
    //         set: {
    //             updatedAt: new Date(),
    //             lastNotifiableEventId: sql.raw(`excluded.${inboxItems.lastNotifiableEventId.name}`),
    //             render: sql.raw(`excluded.${inboxItems.render.name}`),
    //         }
    //     });
    // }
    // else if (event.type === 'comment_edited') {





    //     throw new Error("comment_edited is not implemented");
    // }
    // else if (event.type === 'comment_deleted') {
    //     throw new Error("comment_deleted is not implemented");
    // }
    // else {
    //     throw new Error(`Incorrect event type: "${event.type}"`);
    // }
}

function isEventForUser(event: InferSelectModel<typeof events>, userId: string) {
    if (event.authorId === userId) {
        return false
    }

    return true;
}