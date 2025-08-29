import "dotenv/config";
import { execSync } from "node:child_process";
import { db } from "../src/db";

async function main() {
  console.log("🚀 Starting database initialization...\n");

  try {
    // Step 1: Drop all tables
    console.log("📋 Step 1: Dropping all existing tables...");
    
    // Get all table names from the database
    const tablesQuery = await db.execute(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename NOT LIKE 'pg_%' 
      AND tablename != 'information_schema'
    `);
    
    const tableNames = tablesQuery.rows.map((row: any) => row.tablename);
    
    if (tableNames.length > 0) {
      console.log(`Found ${tableNames.length} tables to drop: ${tableNames.join(", ")}`);
      
      // Drop all tables with CASCADE to handle foreign key constraints
      for (const tableName of tableNames) {
        await db.execute(`DROP TABLE IF EXISTS "${tableName}" CASCADE`);
        console.log(`  ✓ Dropped table: ${tableName}`);
      }
    } else {
      console.log("  ✓ No existing tables found");
    }

    // Step 2: Push schema to database
    console.log("\n📋 Step 2: Pushing schema to database...");
    
    // Use drizzle-kit push to sync schema with database
    execSync("npx drizzle-kit push", { 
      stdio: "inherit",
      cwd: process.cwd()
    });
    console.log("  ✓ Schema pushed successfully");

    console.log("  ✓ Database dropped successfully");

  } catch (error) {
    console.error("❌ Unhandled error:", error);
    process.exit(1);
  }
}

// Run the main function
main().catch((error) => {
  console.error("❌ Unhandled error:", error);
  process.exit(1);
}); 