import 'dotenv/config';
import { db__dangerous } from '../db';
import { runs } from '../schemas/schema';
import { sql } from 'drizzle-orm';

const result = await db__dangerous.execute<{ status: string; count: string }>(
  sql`SELECT ${runs.status}, COUNT(*) as count FROM ${runs} WHERE ${runs.status} IN ('init', 'pending', 'in_progress') GROUP BY ${runs.status}`
);

const total = result.rows.reduce((sum, r) => sum + Number(r.count), 0);

console.log(`Unfinished runs: ${total}`);
for (const row of result.rows) {
  console.log(`  ${row.status}: ${row.count}`);
}

process.exit(0);
