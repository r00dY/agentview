import { db__dangerous } from "../src/db";

console.log("Running 'select 1' test SQL query");

try {
    await db__dangerous.execute('select 1');
    console.log("✅ Success!");
    
    console.log("Closing database connection...");
    
    await db__dangerous.$client.end();
    
    console.log("Database connection closed");
    
} catch (error) {
    console.error("❌ Error!")
    throw error;
}