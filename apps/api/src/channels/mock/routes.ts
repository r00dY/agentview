import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { authn, authorize } from '../../authMiddleware';
import { response_data, response_error } from '../../hono_utils';
import type { ChannelProvider } from '../defineChannel';
import { mockOutbox } from './index';

export function createMockRoutes(mock: ChannelProvider): OpenAPIHono {
  const app = new OpenAPIHono();

  // --- POST / ---

  const createChannelRoute = createRoute({
    method: 'post',
    path: '/create-channel',
    summary: 'Create mock channel',
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

  app.openapi(createChannelRoute, async (c) => {
    const principal = await authn(c.req.raw.headers);
    authorize(principal, { action: 'environment:write' });

    const body = c.req.valid('json');

    const channel = await mock.createChannel(
      principal.organizationId,
      body.address,
      {},
    );

    return c.json(channel, 200);
  });

  // --- POST /messages ---

  const sendMessageRoute = createRoute({
    method: 'post',
    path: '/send-message',
    summary: 'Send mock email message',
    tags: ['Channels'],
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              address: z.string(),
              sourceId: z.string(),
              date: z.string(),
              sourceThreadId: z.string().optional(),
              text: z.string(),
              providerData: z.any().optional(),
              author: z.object({
                email: z.string(),
                name: z.string().optional(),
                headline: z.string().optional(),
                details: z.string().optional(),
              })
            }),
          },
        },
      },
    },
    responses: {
      200: response_data(z.any()),
      401: response_error(),
      404: response_error(),
      500: response_error(),
    },
  });

  app.openapi(sendMessageRoute, async (c) => {
    const principal = await authn(c.req.raw.headers);
    authorize(principal, { action: 'environment:write' });

    const body = c.req.valid('json');

    const channel = await mock.getChannel(body.address);
    if (!channel) {
      return c.json({ message: 'Mock channel not found for this address' }, 404);
    }

    try {
      const result = await mock.ingestMessage(body.address, {
        sourceId: body.sourceId,
        date: body.date,
        sourceThreadId: body.sourceThreadId,
        text: body.text,
        providerData: body.providerData,
        author: body.author,
      });

      return c.json(result, 200);
    } catch (error: any) {
      return c.json({ message: error?.message ?? 'Unknown error' }, 500);
    }
  });

  // --- POST /outbox (internal, called from worker process) ---

  const postOutboxRoute = createRoute({
    method: 'post',
    path: '/outbox',
    summary: 'Store outbox entry (internal)',
    tags: ['Channels'],
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              id: z.string(),
              address: z.string(),
              text: z.string().nullable(),
              timestamp: z.number(),
            }),
          },
        },
      },
    },
    responses: {
      200: response_data(z.any()),
    },
  });

  app.openapi(postOutboxRoute, async (c) => {
    const entry = c.req.valid('json');
    mockOutbox.push(entry);
    return c.json({ ok: true }, 200);
  });

  // --- GET /outbox ---

  const getOutboxRoute = createRoute({
    method: 'get',
    path: '/outbox',
    summary: 'Get mock outbox (in-memory, for testing)',
    tags: ['Channels'],
    request: {
      query: z.object({
        address: z.string().optional(),
      }),
    },
    responses: {
      200: response_data(z.any()),
      401: response_error(),
    },
  });

  app.openapi(getOutboxRoute, async (c) => {
    const principal = await authn(c.req.raw.headers);
    authorize(principal, { action: 'environment:read' });

    const { address } = c.req.valid('query');

    const entries = address
      ? mockOutbox.filter(e => e.address === address)
      : mockOutbox;

    return c.json(entries, 200);
  });

  return app;
}
