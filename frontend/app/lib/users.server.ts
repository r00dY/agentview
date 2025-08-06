import { db } from "./db.server";
import { users } from "~/db/auth-schema";
import { count } from "drizzle-orm";

export async function getUsersCount() {
    console.log('getUsersCount');
    try {
        const result = await db.select({ count: count() }).from(users);
        console.log('result', result);
        return result[0].count;
    } catch (error) {
        console.error('Error in getUsersCount:', error instanceof Error ? error.stack || error.message : error);
        throw error;
    }
}