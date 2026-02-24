import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { authn, authorize } from '../../authMiddleware';
import { response_data, response_error } from '../../hono_utils';
import type { ChannelProvider } from '../defineChannel';

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

  return app;
}
