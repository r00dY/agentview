import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { authn, authorize } from '../../authMiddleware';
import { response_data, response_error } from '../../hono_utils';
import type { ChannelProvider } from '../defineChannel';

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
              contact: z.string(),
              contactKind: z.string(),
              sourceThreadId: z.string().optional(),
              text: z.string(),
              providerData: z.any().optional(),
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

  app.openapi(sendMessageRoute, async (c) => {
    const principal = await authn(c.req.raw.headers);
    authorize(principal, { action: 'environment:write' });

    const body = c.req.valid('json');

    const channel = await mock.getChannel(body.address);
    if (!channel) {
      return c.json({ message: 'Mock channel not found for this address' }, 404);
    }

    const result = await mock.ingestMessage(body.address, {
      sourceId: body.sourceId,
      contact: body.contact,
      contactKind: body.contactKind,
      sourceThreadId: body.sourceThreadId,
      text: body.text,
      providerData: body.providerData,
    });

    return c.json(result, 200);
  });

  return app;
}
