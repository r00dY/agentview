import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { and, desc, eq, sql } from 'drizzle-orm';
import { authn, authorize } from '../authMiddleware';
import { withOrg } from '../withOrg';
import { channels, channelThreads, channelMessages, environments } from '../schemas/schema';
import { users } from '../schemas/auth-schema';
import { response_data, response_error } from '../hono_utils';
import { ChannelSchema, EnvironmentBaseSchema } from 'agentview/apiTypes';

export const channelsApp = new OpenAPIHono();

// --- Helpers ---

function normalizeNumberParam(value: number | string | undefined, defaultValue: number) {
  let numValue: number;

  if (!value) {
    numValue = defaultValue;
  } else if (typeof value === 'string') {
    numValue = parseInt(value);
  } else {
    numValue = value;
  }

  if (isNaN(numValue)) {
    return 1;
  }

  return Math.max(numValue, 1);
}

function buildPaginationMetadata(totalCount: number, page: number, limit: number, offset: number) {
  const totalPages = Math.ceil(totalCount / limit);
  return {
    totalCount,
    totalPages,
    page,
    limit,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
    currentPageStart: offset + 1,
    currentPageEnd: Math.min(offset + limit, totalCount),
  };
}

function formatChannelRow(row: {
  id: string;
  type: string;
  address: string;
  status: string;
  agent: string | null;
  createdAt: string;
  updatedAt: string;
  envId: string | null;
  envUserId: string | null;
  envCreatedAt: string | null;
  envUserEmail: string | null;
}) {
  return {
    id: row.id,
    type: row.type,
    address: row.address,
    status: row.status,
    environment: row.envId ? {
      id: row.envId,
      userId: row.envUserId,
      name: row.envUserEmail ? `dev-${row.envUserEmail}` : 'prod',
      createdAt: row.envCreatedAt!,
    } : null,
    agent: row.agent,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// --- GET /api/channels ---

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

// --- GET /api/channels/:channelId/messages ---

const channelMessagesGETRoute = createRoute({
  method: 'get',
  path: '/api/channels/{channelId}/messages',
  summary: 'List channel messages',
  tags: ['Channels'],
  request: {
    params: z.object({
      channelId: z.string(),
    }),
    query: z.object({
      page: z.union([z.number(), z.string()]).optional(),
      limit: z.union([z.number(), z.string()]).optional(),
    }),
  },
  responses: {
    200: response_data(z.object({
      messages: z.array(z.any()),
      pagination: z.any(),
    })),
    401: response_error(),
    404: response_error(),
  },
});

channelsApp.openapi(channelMessagesGETRoute, async (c) => {
  const principal = await authn(c.req.raw.headers);
  authorize(principal, { action: 'environment:read' });

  const { channelId } = c.req.param();
  const query = c.req.valid('query');

  const page = normalizeNumberParam(query.page, 1);
  const limit = normalizeNumberParam(query.limit, 50);
  const offset = (page - 1) * limit;

  return withOrg(principal.organizationId, async (tx) => {
    // Verify channel exists in this org
    const channel = await tx.query.channels.findFirst({
      where: eq(channels.id, channelId),
    });

    if (!channel) {
      return c.json({ message: 'Channel not found' }, 404);
    }

    // Join through channel_threads to get messages
    const whereClause = eq(channelThreads.channelId, channelId);

    // Count
    const countResult = await tx
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(channelMessages)
      .innerJoin(channelThreads, eq(channelMessages.channelThreadId, channelThreads.id))
      .where(whereClause);

    const totalCount = countResult[0]?.count ?? 0;

    // Fetch messages
    const messages = await tx
      .select({
        id: channelMessages.id,
        organizationId: channelMessages.organizationId,
        channelThreadId: channelMessages.channelThreadId,
        direction: channelMessages.direction,
        sourceId: channelMessages.sourceId,
        text: channelMessages.text,
        attachments: channelMessages.attachments,
        providerData: channelMessages.providerData,
        runId: channelMessages.runId,
        status: channelMessages.status,
        failReason: channelMessages.failReason,
        createdAt: channelMessages.createdAt,
        updatedAt: channelMessages.updatedAt,
      })
      .from(channelMessages)
      .innerJoin(channelThreads, eq(channelMessages.channelThreadId, channelThreads.id))
      .where(whereClause)
      .orderBy(desc(channelMessages.createdAt))
      .limit(limit)
      .offset(offset);

    return c.json({
      messages,
      pagination: buildPaginationMetadata(totalCount, page, limit, offset),
    }, 200);
  });
});

// --- PATCH /api/channels/:channelId ---

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
            agent: z.string().nullable().optional(),
            status: z.enum(['active', 'archived']).optional(),
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
    if (body.agent !== undefined) updates.agent = body.agent;
    if (body.status !== undefined) updates.status = body.status;

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
