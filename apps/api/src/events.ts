import { events } from "./db/schema";
import { db } from "./db";
import { desc } from "drizzle-orm";

export async function getLastEvent(tx?: Parameters<Parameters<typeof db["transaction"]>[0]>[0]) {
    const lastEvent = await (tx || db).select().from(events).orderBy(desc(events.id)).limit(1);
    return lastEvent[0]
}
