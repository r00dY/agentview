# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Structure

This is a full-stack AI agent application called "AgentView" with a React Router frontend and Hono backend. The architecture consists of:

- **Frontend** (`/frontend`): React Router v7 application with TypeScript, TailwindCSS, and Radix UI components
- **Backend** (`/backend`): Minimal Hono server (currently placeholder)
- **Database**: PostgreSQL with Drizzle ORM for schema management
- **Authentication**: Better Auth for user management and authentication

## Development Commands

### Frontend (main application)
```bash
cd frontend
npm install
npm run dev          # Start development server (http://localhost:5173)
npm run build        # Build for production
npm run typecheck    # Run TypeScript type checking
```

### Backend 
```bash
cd backend
npm install
npm run dev          # Start backend development server with watch mode
npm run build        # Build TypeScript to JavaScript
npm run start        # Start production server
```

### Database
```bash
# Start PostgreSQL with Docker Compose
docker-compose up -d postgres-db

# Access pgAdmin at http://localhost:5433 (admin@admin.com / admin)
docker-compose up -d postgres-admin
```

## Key Architecture Concepts

### Agent System
The core application is built around an agent system defined in `frontend/app/agentview.config.ts`:
- **Threads**: Conversations with specific types (e.g., "pdp_chat")  
- **Activities**: Individual items within threads (messages, actions)
- **Run Function**: Stateless agent endpoint that processes thread input and yields responses

### Thread Orchestration
The system supports complex thread management with streaming:
- **Thread States**: `idle`, `failed`, `in_progress` (only one active run per thread)
- **Streaming**: Two types - full items and item chunks (message parts, thinking tokens)
- **API Endpoints**: 
  - `GET /threads/{id}` - Full thread state
  - `/threads/{id}/watch` - SSE streaming for real-time updates

### Database Schema
- **Auth Schema** (`app/db/auth-schema.ts`): User management via Better Auth
- **Main Schema** (`app/db/schema.ts`): Application-specific tables (threads, activities, etc.)
- **Drizzle Config**: PostgreSQL connection with migrations in `./drizzle`

### Frontend Structure
- **Routes**: File-based routing in `app/routes/` with sidebar layout
- **Components**: Reusable UI components in `app/components/ui/` (shadcn/ui style)
- **API Layer**: Client-side API utilities in `app/api/`
- **Authentication**: Login/signup flows with member management

## Environment Setup

Required environment variables:
- `DATABASE_URL`: PostgreSQL connection string
- `OPENAI_API_KEY`: For AI agent functionality (optional, commented out in config)

## Key Files to Understand

- `frontend/app/agentview.config.ts`: Agent configuration and run logic
- `frontend/app/lib/types.ts`: TypeScript type definitions
- `docs/orchestration.md`: Detailed architecture documentation for thread management
- `frontend/app/routes.ts`: Route definitions
- Database schemas in `frontend/app/db/`

## Development Notes

- The agent run function is currently a mock implementation that yields test responses
- OpenAI integration is commented out but prepared in the config
- The backend is minimal - most logic currently resides in the frontend
- Thread state management follows specific patterns for consistency (see orchestration.md)
- Failed thread handling discards failed activities when new items are posted