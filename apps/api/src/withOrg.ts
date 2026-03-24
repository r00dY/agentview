import { sql } from 'drizzle-orm';
import { db__dangerous } from './db';
import type { Transaction } from './types';

export type AfterCommit = (fn: () => void | Promise<void>) => void;

export type OrgTransaction = Transaction & {
  afterCommit: AfterCommit;
  organizationId: string;
};

/**
 * Executes a function within a transaction with the organization context set.
 * This enables PostgreSQL RLS policies to filter data by organization.
 *
 * The callback receives an `OrgTransaction` — a regular drizzle transaction
 * extended with `afterCommit` and `organizationId`.
 *
 * @example
 * ```ts
 * const session = await withOrg(principal.organizationId, async (tx) => {
 *   return tx.query.sessions.findFirst({
 *     where: eq(sessions.id, sessionId),
 *   });
 * });
 * ```
 *
 * @example
 * ```ts
 * await withOrg(principal.organizationId, async (tx) => {
 *   await tx.insert(runs).values({ ... });
 *   tx.afterCommit(async () => {
 *     await notifyExternalService();
 *   });
 * });
 * ```
 */
export async function withOrg<T>(
  organizationId: string,
  fn: (tx: OrgTransaction) => Promise<T>
): Promise<T> {
  const afterCommitCallbacks: (() => void | Promise<void>)[] = [];

  const result = await db__dangerous.transaction(async (tx) => {
    // Switch to app_user role to enforce RLS (admin is superuser, bypasses RLS)
    await tx.execute(sql.raw(`SET LOCAL ROLE "${process.env.POSTGRES_APP_USER}"`));

    // Set the organization context for RLS policies
    await tx.execute(
      sql`SELECT set_config('app.organization_id', ${organizationId}, true)`
    );

    const orgTx = Object.assign(tx, {
      afterCommit: (cb: () => void | Promise<void>) => { afterCommitCallbacks.push(cb) },
      organizationId,
    }) as OrgTransaction;

    return fn(orgTx);
  });

  for (const cb of afterCommitCallbacks) {
    await cb();
  }

  return result;
}
