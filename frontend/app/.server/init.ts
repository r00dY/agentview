import "dotenv/config";
import { auth } from "./auth";
import { db } from "./db";
import { users } from "./db/auth-schema";
import { eq } from "drizzle-orm";

const user = await db.query.users.findFirst({
  where: eq(users.email, 'admin@example.com'),
})

console.log('user', user)

// Get CLI arguments
const args = process.argv.slice(2);

if (args.length !== 3) {
  console.error('Usage: node init.ts <email> <password> <name>');
  console.error('Example: node init.ts user@example.com mypassword "John Doe"');
  process.exit(1);
}

const [email, password, name] = args;

// Validate inputs
if (!email || !password || !name) {
  console.error('Error: All parameters (email, password, name) are required');
  process.exit(1);
}

// Basic email validation
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (!emailRegex.test(email)) {
  console.error('Error: Please provide a valid email address');
  process.exit(1);
}

if (password.length < 3) {
  console.error('Error: Password must be at least 3 characters long');
  process.exit(1);
}

if (name.trim().length === 0) {
  console.error('Error: Name cannot be empty');
  process.exit(1);
}

console.log('Creating user with the following details:');
console.log(`Email: ${email}`);
console.log(`Name: ${name}`);
console.log('Password: [hidden]');

try {
  const { headers } = await auth.api.signUpEmail({
    returnHeaders: true,
    body: {
      email,
      password,
      name: name.trim(),
    //   invitationId: undefined // No invitation required for CLI signup
    },
  });

  console.log('✅ User created successfully!');
  console.log('Headers:', headers);
} catch (error) {
  console.error('❌ Error creating user:', error instanceof Error ? error.message : error);
  process.exit(1);
}