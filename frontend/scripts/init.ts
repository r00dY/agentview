import "dotenv/config";
import * as readline from "node:readline";
import { execSync } from "node:child_process";
import { auth } from "../app/.server/auth";
import { db } from "../app/.server/db";

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Helper function to prompt user for input
function askQuestion(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer: string) => {
      resolve(answer.trim());
    });
  });
}

// Helper function to validate email
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

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

    // Step 3: Create admin user
    console.log("\n📋 Step 3: Creating admin user...");
    
    let email: string;
    let password: string;
    let name: string;

    // Get email
    while (true) {
      email = await askQuestion("Enter admin email: ");
      if (!email) {
        console.log("❌ Email cannot be empty. Please try again.");
        continue;
      }
      if (!isValidEmail(email)) {
        console.log("❌ Please enter a valid email address.");
        continue;
      }
      break;
    }

    // Get password
    while (true) {
      password = await askQuestion("Enter admin password: ");
      if (!password) {
        console.log("❌ Password cannot be empty. Please try again.");
        continue;
      }
      if (password.length < 3) {
        console.log("❌ Password must be at least 3 characters long. Please try again.");
        continue;
      }
      break;
    }

    // Get name
    while (true) {
      name = await askQuestion("Enter admin name: ");
      if (!name || name.trim().length === 0) {
        console.log("❌ Name cannot be empty. Please try again.");
        continue;
      }
      name = name.trim();
      break;
    }

    console.log("\nCreating user with the following details:");
    console.log(`Email: ${email}`);
    console.log(`Name: ${name}`);
    console.log("Password: [hidden]");

    // Create the user
    const { headers } = await auth.api.signUpEmail({
      returnHeaders: true,
      body: {
        email,
        password,
        name,
      },
    });

    console.log("\n✅ Database initialization completed successfully!");
    console.log("✅ Admin user created successfully!");
    console.log("Headers:", headers);

  } catch (error) {
    console.error("\n❌ Error during initialization:", error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Run the main function
main().catch((error) => {
  console.error("❌ Unhandled error:", error);
  process.exit(1);
}); 