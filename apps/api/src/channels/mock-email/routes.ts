import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { and, eq } from 'drizzle-orm';
import { authn, authorize } from '../../authMiddleware';
import { withOrg } from '../../withOrg';
import { channelThreads, channelMessages } from '../../schemas/schema';
import { response_data, response_error } from '../../hono_utils';
import type { channelProvider } from '../operations';

type ChannelProvider = ReturnType<typeof channelProvider>;

export function createMockEmailRoutes(mockEmail: ChannelProvider): OpenAPIHono {
  const app = new OpenAPIHono();

  // --- POST / ---

  const createMockEmailRoute = createRoute({
    method: 'post',
    path: '/',
    summary: 'Create mock-email channel',
    tags: ['Channels'],
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
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

  app.openapi(createMockEmailRoute, async (c) => {
    const principal = await authn(c.req.raw.headers);
    authorize(principal, { action: 'environment:write' });

    const body = c.req.valid('json');

    const channel = await mockEmail.createChannel(
      principal.organizationId,
      body.address,
      {},
    );

    return c.json(channel, 200);
  });

  // --- POST /messages ---

  const sendMockEmailRoute = createRoute({
    method: 'post',
    path: '/messages',
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

  app.openapi(sendMockEmailRoute, async (c) => {
    const principal = await authn(c.req.raw.headers);
    authorize(principal, { action: 'environment:write' });

    const body = c.req.valid('json');

    const channel = await mockEmail.getChannel(body.address);
    if (!channel) {
      return c.json({ message: 'Mock-email channel not found for this address' }, 404);
    }

    const result = await mockEmail.ingestMessage(body.address, {
      contact: body.contact,
      contactKind: 'email',
      sourceThreadId: body.threadId,
      text: body.body,
      providerData: body.subject ? { subject: body.subject } : null,
    });

    return c.json(result, 200);
  });

  // --- GET /messages ---

  const getMockEmailMessagesRoute = createRoute({
    method: 'get',
    path: '/messages',
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

  app.openapi(getMockEmailMessagesRoute, async (c) => {
    const principal = await authn(c.req.raw.headers);
    authorize(principal, { action: 'environment:read' });

    const query = c.req.valid('query');

    const channel = await mockEmail.getChannel(query.address);
    if (!channel) {
      return c.json({ message: 'Mock-email channel not found for this address' }, 404);
    }

    return withOrg(principal.organizationId, async (tx) => {
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

  return app;
}
