import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { and, eq } from 'drizzle-orm';
import { authn, authorize } from '../../authMiddleware';
import { withOrg } from '../../withOrg';
import { channels, channelThreads, channelMessages } from '../../schemas/schema';
import { response_data, response_error } from '../../hono_utils';
import { upsertChannel, ingestMessage } from '../operations';

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

  const channel = await upsertChannel({
    organizationId: principal.organizationId,
    type: 'mock-email',
    name: body.name,
    address: body.address,
    config: {},
  });

  return c.json(channel, 200);
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

  const channel = await withOrg(principal.organizationId, async (tx) => {
    return tx.query.channels.findFirst({
      where: and(
        eq(channels.type, 'mock-email'),
        eq(channels.address, body.address),
      ),
    });
  });

  if (!channel) {
    return c.json({ message: 'Mock-email channel not found for this address' }, 404);
  }

  const result = await ingestMessage(channel, {
    contact: body.contact,
    contactKind: 'email',
    sourceThreadId: body.threadId,
    direction: 'incoming',
    text: body.body,
    providerData: body.subject ? { subject: body.subject } : null,
  });

  return c.json(result, 200);
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
    const channel = await tx.query.channels.findFirst({
      where: and(
        eq(channels.type, 'mock-email'),
        eq(channels.address, query.address),
      ),
    });

    if (!channel) {
      return c.json({ message: 'Mock-email channel not found for this address' }, 404);
    }

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
