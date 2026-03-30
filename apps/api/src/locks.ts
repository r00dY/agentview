import type { OrgTransaction } from "./withOrg";
import { sql } from "drizzle-orm";

/**
 * General purpose lock for resource creation.
 * It's general purpose "registry" actor that serializes resource creation.
 */
export async function acquireCreateResourceLock(tx: OrgTransaction) {
    const lockKey = `${tx.organizationId}:resource_create`;
    await tx.execute(sql`SELECT pg_advisory_lock(hashtext(${lockKey}))`);
}