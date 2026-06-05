import { sql } from 'drizzle-orm';
import { db__dangerous } from './db';
import { setContext } from './logger';
import type { Transaction } from './types';
import { getPrincipalLogContext, type Principal } from './authMiddleware';

export type AfterCommit = (fn: () => void | Promise<void>) => void;

type ChannelThreadLock = { type: "edit_channel_thread", channelThreadId: string }


type EditSessionLock = { type: "edit_session", sessionId: string }
type CreateResourceLock = { type: "create_resource" }
type Lock = EditSessionLock | CreateResourceLock | ChannelThreadLock;

function getLockKey(organizationId: string, lock: Lock) {
  if (lock.type === "edit_session") {
    return `${organizationId}:edit_session:${lock.sessionId}`;
  } else if (lock.type === "create_resource") {
    return `${organizationId}:create_resource`;
  } else if (lock.type === "edit_channel_thread") {
    return `${organizationId}:edit_channel_thread:${lock.channelThreadId}`;
  }
}

export type OrgTransaction = Transaction & {
  afterCommit: AfterCommit;
  organizationId: string;
  acquireLock: (lock: Lock) => Promise<void>;
};

export type TenantTransaction = OrgTransaction & {
  principal: Principal;
};

export async function withOrg<T>(
  organizationId: string,
  fn: (tx: OrgTransaction) => Promise<T>
): Promise<T> {
  setContext({ organizationId });

  const afterCommitCallbacks: (() => void | Promise<void>)[] = [];

  let lockedSessionId : string | undefined = undefined;

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
      acquireLock: async (lock: Lock) => { 

        // We can't allow for create_resource lock be added after edit_session lock. Deadlock prevention.
        if (lock.type === "create_resource" && lockedSessionId) {
          await tx.rollback();
          throw new Error("!!!!!!!!!!!!!!!!! LOCK ORDER VIOLATION. 'create_resource' after 'edit_session' !!!!!!!!!!!!!!!!! ");
        } else if (lock.type === "edit_session") {
          if (lockedSessionId && lockedSessionId !== lock.sessionId) {
            await tx.rollback();
            throw new Error("!!!!!!!!!!!!!!!!! LOCK ORDER VIOLATION. multiple sessions locked !!!!!!!!!!!!!!!!! ");
          }
          lockedSessionId = lock.sessionId;
        }

        const lockKey = getLockKey(organizationId, lock);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

      },
    }) as OrgTransaction;

    return fn(orgTx);
  });

  for (const cb of afterCommitCallbacks) {
    await cb();
  }

  return result;
}

export async function withTenant<T>(
  principal: Principal,
  fn: (tx: TenantTransaction) => Promise<T>
): Promise<T> {
  setContext({
    organizationId: principal.organizationId,
    principalType: principal.type,
    ...getPrincipalLogContext(principal),
  });
  return withOrg(principal.organizationId, async (tx) => {
    return fn(Object.assign(tx, { principal }) as TenantTransaction);
  });
}
