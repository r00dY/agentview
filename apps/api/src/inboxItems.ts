import type { InboxItem } from "./shared/apiTypes";

export function isInboxItemUnread(inboxItem: InboxItem) {
    if (inboxItem.lastNotifiableEventId === null && inboxItem.lastReadEventId === null) {
        return false;
    }

    if (inboxItem.lastNotifiableEventId === null) {
        return true;
    }

    if (inboxItem.lastNotifiableEventId > (inboxItem.lastReadEventId ?? 0)) {
        return true;
    }

    return false;
}

