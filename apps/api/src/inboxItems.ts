import type { InferSelectModel } from "drizzle-orm";
import type { inboxItems } from "./schemas/schema";

export function isInboxItemUnread(inboxItem: InferSelectModel<typeof inboxItems> | null | undefined) {
    if (!inboxItem) {
        return false;
    }

    if (inboxItem.lastNotifiableEventId === null) {
        return false;
    }

    if (inboxItem.lastNotifiableEventId > (inboxItem.lastReadEventId ?? 0)) {
        return true;
    }

    return false;
}

