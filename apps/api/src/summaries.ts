import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { withOrg } from './withOrg';
import { log, setContext } from './logger';
import { sessions, sessionItems } from './schemas/schema';
import { eq, and, asc } from 'drizzle-orm';

/**
 * Generates a summary for a session using OpenAI's API.
 * Uses the first session item to generate a concise 1-liner summary.
 *
 * Requires OPENAI_API_KEY environment variable to be set.
 */
export async function generateSessionSummary(sessionId: string, organizationId: string): Promise<string | undefined> {
  setContext({ sessionId });

  const client = new OpenAI();

  // Skip if session already has a title (e.g. set from email subject)
  const session = await withOrg(organizationId, async (tx) => {
    return tx.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      columns: { title: true },
    });
  });

  if (session?.title) {
    log.info({ sessionId }, 'session already has a title, skipping generation');
    return session.title;
  }

  // Fetch session with its first item
  const firstItem = await withOrg(organizationId, async (tx) => {
    return tx.query.sessionItems.findFirst({
      where: and(
        eq(sessionItems.sessionId, sessionId),
        eq(sessionItems.isState, false)
      ),
      orderBy: [asc(sessionItems.sortOrder)],
    });
  });

  if (!firstItem) {
    log.warn({ sessionId }, 'no session items found for summary generation');
    return undefined;
  }

  const response = await client.responses.parse({
    model: "gpt-5-nano",
    instructions: `You're gonna be given a JSON with first item of an AI agent session. Your task is to generate a title for the session. It must be ultra short 1-liner, it's gonna be displayed as a title in a session card 300px wide (one line).`,
    input: JSON.stringify(firstItem.content),
    text: {
      format: zodTextFormat(z.object({ title: z.string() }), "response"),
    }
  });

  const title = response.output_parsed?.title;


  if (title) {
    await withOrg(organizationId, async (tx) => {
      await tx.update(sessions)
        .set({ title, updatedAt: new Date().toISOString() })
        .where(eq(sessions.id, sessionId));
    });
  }

  return title;
}
