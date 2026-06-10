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

      // Why this flag exists:
      //
      // `withOrg` runs every org-scoped transaction with `SET LOCAL ROLE
      // "$POSTGRES_APP_USER"` so that RLS policies actually apply — Postgres
      // superusers (and BYPASSRLS roles) silently skip RLS, which would defeat
      // the whole tenancy model.
      //
      // In local dev we connect to Docker Postgres as a superuser, so we need
      // a *separate* non-privileged role to switch into. This block bootstraps
      // that role and gives it the data-plane grants it needs. Set
      // POSTGRES_SHOULD_CREATE_APP_USER=true and POSTGRES_APP_USER=agentview_app
      // (or similar) locally.
      //
      // On managed Postgres (e.g. Render) we already connect as a non-superuser
      // that owns the database — that user is itself a valid RLS subject, so
      // there's no second role to create. Set POSTGRES_APP_USER to the
      // connection user (e.g. `agentview`) and leave this flag unset/false:
      // `SET LOCAL ROLE "agentview"` is then a trivial self-switch, and RLS
      // applies because the connection user is not a superuser.
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

        // pg-boss schema — app_user needs to enqueue jobs within RLS transactions.
        // pg-boss creates this schema/tables lazily in startBoss(), which runs AFTER
        // initDb(). On a fresh DB the schema doesn't exist yet, so create it here;
        // and use ALTER DEFAULT PRIVILEGES so tables created later by pg-boss
        // automatically grant access to app_user.
        await db__dangerous.execute(sql`CREATE SCHEMA IF NOT EXISTS pgboss`);
        await db__dangerous.execute(sql.raw(`GRANT USAGE ON SCHEMA pgboss TO "${appUserRole}"`));
        await db__dangerous.execute(sql.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO "${appUserRole}"`));
        await db__dangerous.execute(sql.raw(`ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${appUserRole}"`));

        log.info({ appUserRole }, 'created and granted privileges to app user');
      }
    } finally {
      await db__dangerous.execute(sql`SELECT pg_advisory_unlock(${INIT_LOCK_ID})`);
    }
}