// import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';
import { databaseURL } from './src/databaseURL';

export default defineConfig({
  out: './drizzle',
  schema: ['./src/schemas/schema.ts', './src/schemas/auth-schema.ts'],
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseURL
  },
});
