import { extractMentions } from "./utils";

// Simple tests for mention extraction
console.log("Testing mention extraction...");

// Test 1: Single mention
const test1 = extractMentions("Hello @[user_id:abc123] how are you?");
console.log("Test 1:", test1); // Expected: { "user_id": ["abc123"] }

// Test 2: Multiple mentions
const test2 = extractMentions("Thanks @[user_id:user123] and @[user_id:admin456] for the help!");
console.log("Test 2:", test2); // Expected: { "user_id": ["user123", "admin456"] }

// Test 3: No mentions
const test3 = extractMentions("This is a regular comment without mentions.");
console.log("Test 3:", test3); // Expected: {}

// Test 4: Duplicate mentions
const test4 = extractMentions("Hello @[user_id:abc123] and @[user_id:abc123] again!");
console.log("Test 4:", test4); // Expected: { "user_id": ["abc123"] }

// Test 5: Invalid format (should throw)
try {
    const test5 = extractMentions("Hello @user123 and @[user_id:] and @[user_id:abc123]");
    console.log("Test 5:", test5);
} catch (error) {
    console.log("Test 5: Error caught:", (error as Error).message);
}

// Test 6: Unsupported property (should throw)
try {
    const test6 = extractMentions("Hello @[invalid_prop:value]");
    console.log("Test 6:", test6);
} catch (error) {
    console.log("Test 6: Error caught:", (error as Error).message);
}

// Test 7: Missing colon (should throw)
try {
    const test7 = extractMentions("Hello @[user_id]");
    console.log("Test 7:", test7);
} catch (error) {
    console.log("Test 7: Error caught:", (error as Error).message);
}

console.log("All tests completed!"); 