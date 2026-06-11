import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db__dangerous } from './db';
import { log } from './logger';
import { sql } from 'drizzle-orm';
import { startBoss } from './queues/pgboss';

/**
 * Idempotent boot sequence shared by the HTTP server, streaming server, and
 * worker. Holds an advisory lock so concurrent processes don't race on
 * migrations or role creation.
 *
 * Steps:
 *   1. Run Drizzle migrations as the DATABASE_URL connection role (table owner).
 *   2. Create / refresh the `POSTGRES_APP_USER` role that `withOrg` switches into.
 *      We always provision our own role — the connection role typically owns
 *      the tables, and a table owner bypasses RLS by default (only superusers,
 *      BYPASSRLS roles, and `FORCE ROW LEVEL SECURITY` would also bypass it).
 *      Switching to a separate, non-owning role is what makes RLS actually fire.
 *   3. Start pg-boss. It creates its own schema/tables lazily as the connection
 *      role; we pre-create the schema and set ALTER DEFAULT PRIVILEGES so the
 *      pg-boss tables are immediately writable by the app role.
 */
export async function initDb() {
    log.info("initializing db");

    const INIT_LOCK_ID = 123456789;
    await db__dangerous.execute(sql`SELECT pg_advisory_lock(${INIT_LOCK_ID})`);

    try {
      await migrate(db__dangerous, { migrationsFolder: './drizzle' });
      log.info("database migrated successfully");

      const appUserRole = process.env.POSTGRES_APP_USER;

      if (!appUserRole) {
        throw new Error('POSTGRES_APP_USER is not set.');
      }

      // Role name is interpolated into raw SQL below — only allow plain identifiers.
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(appUserRole)) {
        throw new Error(`Invalid POSTGRES_APP_USER: '${appUserRole}'. Must be a valid PostgreSQL identifier.`);
      }

      log.info({ appUserRole }, 'provisioning app user');

      await db__dangerous.execute(sql.raw(`
          DO $$
          BEGIN
            IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${appUserRole}') THEN
              CREATE ROLE "${appUserRole}" NOINHERIT NOLOGIN;
            END IF;
          END
          $$
        `));

      // Re-grant on every boot so new migrations are covered without manual ops.
      await db__dangerous.execute(sql`GRANT USAGE ON SCHEMA public TO ${sql.raw(`"${appUserRole}"`)}`);
      await db__dangerous.execute(sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${sql.raw(`"${appUserRole}"`)}`);
      await db__dangerous.execute(sql`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${sql.raw(`"${appUserRole}"`)}`);

      // pg-boss tables are created lazily inside startBoss() below. Pre-create
      // the schema + default privileges so the app role can enqueue jobs from
      // inside withOrg transactions.
      await db__dangerous.execute(sql`CREATE SCHEMA IF NOT EXISTS pgboss`);
      await db__dangerous.execute(sql.raw(`GRANT USAGE ON SCHEMA pgboss TO "${appUserRole}"`));
      await db__dangerous.execute(sql.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO "${appUserRole}"`));
      await db__dangerous.execute(sql.raw(`ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${appUserRole}"`));

      log.info({ appUserRole }, 'app user provisioned');

      await startBoss();

      // Boss may have just created its tables — re-grant so the app role has
      // access on first boot too (ALTER DEFAULT PRIVILEGES only affects
      // subsequent creates within the same session).
      await db__dangerous.execute(sql.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO "${appUserRole}"`));
      await db__dangerous.execute(sql.raw(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO "${appUserRole}"`));
    } finally {
      await db__dangerous.execute(sql`SELECT pg_advisory_unlock(${INIT_LOCK_ID})`);
    }
}
