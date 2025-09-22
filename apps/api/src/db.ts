import { drizzle } from 'drizzle-orm/node-postgres';
import { schema } from "./schemas/schema";
import { getDatabaseURL } from './getDatabaseURL';

export const db = drizzle(getDatabaseURL(), {
  schema
});
