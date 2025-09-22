import { defineConfig } from 'drizzle-kit';
import { getDatabaseURL } from './src/getDatabaseURL';

export default defineConfig({
  out: './drizzle',
  schema: ['./src/schemas/schema.ts', './src/schemas/auth-schema.ts'],
  dialect: 'postgresql',
  dbCredentials: {
    url: getDatabaseURL()
  },
});
