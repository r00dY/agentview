// import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './drizzle',
  schema: ['./app/.server/db/schema.ts', './app/.server/db/auth-schema.ts'],
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!
  },
});
