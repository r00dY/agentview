import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { authn, authorize } from '../authMiddleware';
import { withOrg } from '../withOrg';
import { channels, channelThreads, environments } from '../schemas/schema';
import { response_data, response_error } from '../hono_utils';
import { ChannelSchema } from 'agentview/apiTypes';

export const channelsApp = new OpenAPIHono();


const channelsGETRoute = createRoute({
  method: 'get',
  path: '/api/channels',
  summary: 'List channels',
  tags: ['Channels'],
  responses: {
    200: response_data(z.array(ChannelSchema)),
    401: response_error(),
  },
});

channelsApp.openapi(channelsGETRoute, async (c) => {
  const principal = await authn(c.req.raw.headers);
  authorize(principal, { action: 'environment:read' });

  return withOrg(principal.organizationId, async (tx) => {

    const channels = await tx.query.channels.findMany({
      with: {
        environment: {
          with: {
            user: true,
          },
        },
      },
    });

    return c.json(channels, 200);
  });
});


const channelPATCHRoute = createRoute({
  method: 'patch',
  path: '/api/channels/{channelId}',
  summary: 'Update channel',
  tags: ['Channels'],
  request: {
    params: z.object({
      channelId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            environmentId: z.string().nullable().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: response_data(ChannelSchema),
    401: response_error(),
    404: response_error(),
    422: response_error(),
  },
});

channelsApp.openapi(channelPATCHRoute, async (c) => {
  const principal = await authn(c.req.raw.headers);
  authorize(principal, { action: 'environment:write' });

  const { channelId } = c.req.param();
  const body = c.req.valid('json');

  return withOrg(principal.organizationId, async (tx) => {
    const channel = await tx.query.channels.findFirst({
      where: eq(channels.id, channelId),
      with: {
        environment: {
          with: {
            user: true,
          },
        },
      },
    });

    if (!channel) {
      return c.json({ message: 'Channel not found' }, 404);
    }

    // Validate environmentId exists in org
    if (body.environmentId) {
      const env = await tx.query.environments.findFirst({
        where: eq(environments.id, body.environmentId),
      });
      if (!env) {
        return c.json({ message: 'Environment not found' }, 422);
      }
    }

    const updates: Record<string, any> = {
      updatedAt: new Date().toISOString(),
    };

    if (body.environmentId !== undefined) updates.environmentId = body.environmentId;

    await tx
      .update(channels)
      .set(updates)
      .where(eq(channels.id, channelId));

    const updateChannel = await tx.query.channels.findFirst({
      with: {
        environment: {
          with: {
            user: true,
          },
        },
      },
      where: eq(channels.id, channelId),
    });

    return c.json(updateChannel!, 200);
  });
});


// const channelThreadsGETRoute = createRoute({
//   method: 'get',
//   path: '/api/channels/{channelId}/threads',
//   summary: 'List channel threads with messages',
//   tags: ['Channels'],
//   request: {
//     params: z.object({
//       channelId: z.string(),
//     }),
//   },
//   responses: {
//     200: response_data(z.array(ChannelThreadSchema)),
//     401: response_error(),
//     404: response_error(),
//   },
// });

// channelsApp.openapi(channelThreadsGETRoute, async (c) => {
//   const principal = await authn(c.req.raw.headers);
//   authorize(principal, { action: 'environment:read' });

//   const { channelId } = c.req.param();

//   return withOrg(principal.organizationId, async (tx) => {
//     const channel = await tx.query.channels.findFirst({
//       where: eq(channels.id, channelId),
//     });

//     if (!channel) {
//       return c.json({ message: 'Channel not found' }, 404);
//     }

//     const threads = await tx.query.channelThreads.findMany({
//       where: eq(channelThreads.channelId, channelId),
//       with: {
//         messages: {
//           orderBy: (msg, { desc }) => [desc(msg.createdAt)],
//         },
//       },
//     });

//     return c.json(threads, 200);
//   });
// });
