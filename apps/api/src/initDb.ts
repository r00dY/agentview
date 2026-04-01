import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db__dangerous } from './db';
import { log } from './logger';
import { sql } from 'drizzle-orm';

export async function initDb() {
    log.info("initializing db");

    // Use advisory lock to prevent concurrent init from HTTP server and worker
    const INIT_LOCK_ID = 123456789;
    await db__dangerous.execute(sql`SELECT pg_advisory_lock(${INIT_LOCK_ID})`);

    try {
      await migrate(db__dangerous, { migrationsFolder: './drizzle' });
      log.info("database migrated successfully");

      // App user role
      const appUserRole = process.env.POSTGRES_APP_USER;

      if (!appUserRole) {
        throw new Error('POSTGRES_APP_USER is not set.');
      }

      // Validate role name to prevent SQL injection (only allow alphanumeric and underscore)
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(appUserRole)) {
        throw new Error(`Invalid POSTGRES_APP_USER: '${appUserRole}'. Must be a valid PostgreSQL identifier.`);
      }

      if (process.env.POSTGRES_SHOULD_CREATE_APP_USER === 'true') {
        log.info({ appUserRole }, 'creating app user');

        // Create role and grant privileges for RLS enforcement
        // DO blocks don't support bind parameters, so we use sql.raw()
        // Role name is validated above to prevent SQL injection
        await db__dangerous.execute(sql.raw(`
            DO $$
            BEGIN
              IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${appUserRole}') THEN
                CREATE ROLE "${appUserRole}" NOINHERIT NOLOGIN;
              END IF;
            END
            $$
          `));

        // Schema usage is needed because db:clear recreates the public schema
        await db__dangerous.execute(sql`GRANT USAGE ON SCHEMA public TO ${sql.raw(`"${appUserRole}"`)}`);
        await db__dangerous.execute(sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${sql.raw(`"${appUserRole}"`)}`);
        await db__dangerous.execute(sql`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${sql.raw(`"${appUserRole}"`)}`);
        log.info({ appUserRole }, 'created and granted privileges to app user');
      }
    } finally {
      await db__dangerous.execute(sql`SELECT pg_advisory_unlock(${INIT_LOCK_ID})`);
    }
}