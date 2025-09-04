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


/**
 * States: 
 * 
 * lastNotifiableId = NULL, lastReadEventId = NULL: 
 * 
 * When someone has NEVER SEEN the thread, then there is no inbox item at all. It means "unread". We decided to TRACK read / unread state for threads.
 * 
 * It means we do standard tracking. The moment INBOX APPEARS ("magically"), everything is tracked there. Each event. isEventForUser() cannot be `false` because event will be ignored, lastNotifiableEventId will be set to null, and all goes to shit.
 * 
 * It's obvious!!!
 * 
 * When new event appears, if we ignore it for this user, it must be still registered for this user if we track the changes for him. It IS the event he listens to.
 * -    if is `isEventForUser()` === false, then we still register it for ALL RELEVANT INBOXES (essentially for all users that have inbox for this particular session). 
 *      if user has no inbox for this session -> good. It means a "default", he has never read it so we don't have to update anything.
 *      but the moment he creates an empty inbox, it means "I read it at time X". So if sth changes we must KNOW. We know by registering events.
 *      so if user has an inbox for this session, we ALWAYS process, no matter if `isEventForUser()` === false.
 * -    so how do we know WHEN TO BOLD? `isEventForUser()` === true, then what? It's actually super trivial. For the inbox_item we just set ATTENTION_LEVEL higher!!!
 * -    it basically means that comments&scores:
 *         - make high attention level for those who watch
 *         - make low attention level for those who don't watch, but who read the session already
 *         - sooo... "small dot" might be when tehre is at least one inbox that is ATTENTION_LEVEL == "low". but "bold + count" should be when there is at least one inbox that is ATTENTION_LEVEL == "high".
 * 
 */


