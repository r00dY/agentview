import { db } from "./db";
import { users } from "./db/auth-schema";
import { count } from "drizzle-orm";

export async function getUsersCount() {
    const result = await db.select({ count: count() }).from(users);
    return result[0].count;
}