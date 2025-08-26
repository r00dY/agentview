# Database Initialization Script

This directory contains the database initialization script for the AgentView application.

## Usage

To initialize the database and create the first admin user, run:

```bash
npm run init
```

## What the script does

1. **Drops all existing tables** - Removes all tables from the database to start fresh
2. **Pushes the schema** - Uses `drizzle-kit push` to create all tables based on the current schema
3. **Creates admin user** - Prompts for email, password, and name to create the first admin user

## Requirements

- PostgreSQL database running and accessible via `DATABASE_URL` environment variable
- All required environment variables set in `.env` file
- Node.js and npm installed

## Interactive Prompts

The script will ask for:
- **Email**: Must be a valid email format
- **Password**: Must be at least 3 characters long
- **Name**: Cannot be empty

## Error Handling

The script includes comprehensive error handling and validation:
- Validates email format
- Ensures password meets minimum requirements
- Validates that name is not empty
- Provides clear error messages for invalid input
- Gracefully handles database connection issues 