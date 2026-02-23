import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { and, eq, isNull, desc } from 'drizzle-orm';
import { authn, authorize } from '../authMiddleware';
import { withOrg } from '../withOrg';
import { channels, channelThreads, channelMessages } from '../schemas/schema';
import { response_data, response_error } from '../hono_utils';

export const mockEmailApp = new OpenAPIHono();

// --- POST /api/channels/mock-email ---

const createMockEmailRoute = createRoute({
  method: 'post',
  path: '/api/channels/mock-email',
  summary: 'Create mock-email channel',
  tags: ['Channels'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().optional(),
            address: z.string(),
          }),
        },
      },
    },
  },
  responses: {
    200: response_data(z.any()),
    401: response_error(),
  },
});

mockEmailApp.openapi(createMockEmailRoute, async (c) => {
  const principal = await authn(c.req.raw.headers);
  authorize(principal, { action: 'environment:write' });

  const body = c.req.valid('json');

  return withOrg(principal.organizationId, async (tx) => {
    const [channel] = await tx
      .insert(channels)
      .values({
        organizationId: principal.organizationId,
        type: 'mock-email',
        name: body.name ?? null,
        address: body.address,
        status: 'active',
        config: {},
      })
      .onConflictDoUpdate({
        target: [channels.organizationId, channels.type, channels.address],
        set: {
          name: body.name ?? null,
          status: 'active',
          updatedAt: new Date().toISOString(),
        },
      })
      .returning();

    return c.json(channel, 200);
  });
});

// --- POST /api/channels/mock-email/messages ---

const sendMockEmailRoute = createRoute({
  method: 'post',
  path: '/api/channels/mock-email/messages',
  summary: 'Send mock email message',
  tags: ['Channels'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            address: z.string(),
            contact: z.string(),
            subject: z.string().optional(),
            body: z.string(),
            threadId: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: response_data(z.any()),
    401: response_error(),
    404: response_error(),
  },
});

mockEmailApp.openapi(sendMockEmailRoute, async (c) => {
  const principal = await authn(c.req.raw.headers);
  authorize(principal, { action: 'environment:write' });

  const body = c.req.valid('json');

  return withOrg(principal.organizationId, async (tx) => {
    // Look up mock-email channel by address
    const channel = await tx.query.channels.findFirst({
      where: and(
        eq(channels.type, 'mock-email'),
        eq(channels.address, body.address),
      ),
    });

    if (!channel) {
      return c.json({ message: 'Mock-email channel not found for this address' }, 404);
    }

    // Find or create channel thread
    const threadWhere = body.threadId
      ? and(
          eq(channelThreads.channelId, channel.id),
          eq(channelThreads.sourceThreadId, body.threadId),
          eq(channelThreads.contact, body.contact),
          eq(channelThreads.contactKind, 'email'),
        )
      : and(
          eq(channelThreads.channelId, channel.id),
          isNull(channelThreads.sourceThreadId),
          eq(channelThreads.contact, body.contact),
          eq(channelThreads.contactKind, 'email'),
        );

    let thread = await tx.query.channelThreads.findFirst({
      where: threadWhere,
    });

    if (!thread) {
      const [newThread] = await tx
        .insert(channelThreads)
        .values({
          organizationId: principal.organizationId,
          channelId: channel.id,
          sourceThreadId: body.threadId ?? null,
          contact: body.contact,
          contactKind: 'email',
          status: 'dirty',
        })
        .returning();
      thread = newThread;
    } else {
      // Set status to dirty unless currently processing
      if (thread.status !== 'processing') {
        await tx
          .update(channelThreads)
          .set({ status: 'dirty', updatedAt: new Date().toISOString() })
          .where(eq(channelThreads.id, thread.id));
      }
    }

    // Insert channel message
    const [message] = await tx
      .insert(channelMessages)
      .values({
        organizationId: principal.organizationId,
        channelThreadId: thread.id,
        direction: 'incoming',
        sourceId: null,
        text: body.body,
        providerData: body.subject ? { subject: body.subject } : null,
        status: 'received',
      })
      .returning();

    return c.json({ message, thread }, 200);
  });
});

// --- GET /api/channels/mock-email/messages ---

const getMockEmailMessagesRoute = createRoute({
  method: 'get',
  path: '/api/channels/mock-email/messages',
  summary: 'List mock email messages',
  tags: ['Channels'],
  request: {
    query: z.object({
      address: z.string(),
      contact: z.string().optional(),
      direction: z.string().optional(),
    }),
  },
  responses: {
    200: response_data(z.any()),
    401: response_error(),
    404: response_error(),
  },
});

mockEmailApp.openapi(getMockEmailMessagesRoute, async (c) => {
  const principal = await authn(c.req.raw.headers);
  authorize(principal, { action: 'environment:read' });

  const query = c.req.valid('query');

  return withOrg(principal.organizationId, async (tx) => {
    // Look up mock-email channel by address
    const channel = await tx.query.channels.findFirst({
      where: and(
        eq(channels.type, 'mock-email'),
        eq(channels.address, query.address),
      ),
    });

    if (!channel) {
      return c.json({ message: 'Mock-email channel not found for this address' }, 404);
    }

    // Find threads for this channel, optionally filtered by contact
    const threadFilters: any[] = [eq(channelThreads.channelId, channel.id)];
    if (query.contact) {
      threadFilters.push(eq(channelThreads.contact, query.contact));
    }

    const threads = await tx.query.channelThreads.findMany({
      where: and(...threadFilters),
      with: {
        messages: {
          where: query.direction
            ? eq(channelMessages.direction, query.direction)
            : undefined,
          orderBy: (msg, { desc }) => [desc(msg.createdAt)],
        },
      },
    });

    const messages = threads.flatMap((t) => t.messages);

    return c.json({ messages }, 200);
  });
});
