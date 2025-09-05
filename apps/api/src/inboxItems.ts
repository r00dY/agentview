import type { InboxItem } from "./shared/apiTypes";

export function isInboxItemUnread(inboxItem: InboxItem | null | undefined) {
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

