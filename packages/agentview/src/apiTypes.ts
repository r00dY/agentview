import { z } from 'zod'

export const InputTargetSchema = z.object({
  sessionId: z.string().optional(),
  runId: z.string().optional(),
  channelMessageId: z.string().optional(),
  sessionItemId: z.string().optional(),
  sessionItemIndex: z.number().int().min(0).optional(),
})
export type InputTarget = z.infer<typeof InputTargetSchema>

export const spaceAllowedValues = ['production', 'playground', 'shared-playground'] as const;


export const SpaceSchema = z.enum(spaceAllowedValues);
export type Space = z.infer<typeof SpaceSchema>

export const UserSchema = z.object({
  id: z.string(),
  externalId: z.string().nullable(),
  email: z.string().nullable(),
  createdAt: z.iso.date(),
  updatedAt: z.iso.date(),
  ownerId: z.string().nullable(),
  space: SpaceSchema,
})

export type User = z.infer<typeof UserSchema>

export const UserCreateSchema = UserSchema.pick({
  externalId: true,
  email: true,
  space: true, // default based on env
  ownerId: true,
}).partial();

export type UserCreate = z.infer<typeof UserCreateSchema>

export const UserWithTokenSchema = z.object({
  user: UserSchema,
  token: z.string()
})

export type UserWithToken = z.infer<typeof UserWithTokenSchema>

export const ScoreSchema = z.object({
  id: z.string(),

  sessionId: z.string(),
  sessionItemId: z.string().nullable(),
  sessionItemIndex: z.number().int().min(0).nullable(),
  channelMessageId: z.string().nullable(),
  runId: z.string().nullable(),

  name: z.string(),
  value: z.any(),
  commentId: z.string().nullable(),

  createdBy: z.string(),
  createdAt: z.iso.date(),
  updatedAt: z.iso.date(),
  deletedAt: z.iso.date().nullable(),
  deletedBy: z.string().nullable(),
})

export type Score = z.infer<typeof ScoreSchema>

export const ScoreCreateSchema = ScoreSchema.pick({
  name: true,
  value: true,
})

export type ScoreCreate = z.infer<typeof ScoreCreateSchema>



export const CommentMessageSchema = z.object({
  id: z.string(),

  sessionId: z.string(),
  sessionItemId: z.string().nullable(),
  sessionItemIndex: z.number().int().min(0).nullable(),
  runId: z.string().nullable(),
  channelMessageId: z.string().nullable(),

  userId: z.string(),
  content: z.string().nullable(),
  createdAt: z.iso.date(),
  updatedAt: z.iso.date().nullable(),
  deletedAt: z.iso.date().nullable(),
  deletedBy: z.string().nullable(),
  score: ScoreSchema.nullable(),
})

export type CommentMessage = z.infer<typeof CommentMessageSchema>

export const CommentMessageCreateSchema = z.object({
  content: z.string()
})

export type CommentMessageCreate = z.infer<typeof CommentMessageCreateSchema>



// Environments

export const EnvironmentBaseSchema = z.object({
  id: z.string(),
  handle: z.string(),
  createdAt: z.iso.date(),
  user: z.any(),
  tunnelUrl: z.string().nullable().optional(),
})

export type EnvironmentBase = z.infer<typeof EnvironmentBaseSchema>

export const EnvironmentSchema = EnvironmentBaseSchema.extend({
  config: z.any(),
})

export type Environment = z.infer<typeof EnvironmentSchema>

export const EnvironmentCreateSchema = z.object({
  config: z.any().optional(),
  tunnelUrl: z.httpUrl().nullish(),
})

export type EnvironmentCreate = z.infer<typeof EnvironmentCreateSchema>



// Channels

export const ChannelSchema = z.object({
  id: z.string(),
  type: z.string(),
  address: z.string(),
  environment: EnvironmentBaseSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Channel = z.infer<typeof ChannelSchema>

export const ChannelMessageSchema = z.object({
  id: z.string(),
  direction: z.enum(['incoming', 'outgoing']),
  sourceId: z.string().nullable(),
  text: z.string().nullable(),
  attachments: z.any().nullable(),
  providerData: z.any().nullable(),
  date: z.string(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type ChannelMessage = z.infer<typeof ChannelMessageSchema>

// Session

export const SessionItemSchema = z.object({
  id: z.string(),
  createdAt: z.iso.date(),
  updatedAt: z.iso.date(),
  type: z.enum(['input', 'output', 'step']),
  content: z.any(),
  runId: z.string(), // potential bloat
  sessionId: z.string(), // potential bloat
})

export type SessionItem = z.infer<typeof SessionItemSchema>



export const AgentRefSchema = z.object({
  agent: z.string(),
  version: z.string(),
  adapter: z.enum(['agentview', 'ai-sdk']),
})

export type AgentRef = z.infer<typeof AgentRefSchema>

export const RunBaseSchema = z.object({
  id: z.string(),
  createdAt: z.iso.date(),
  updatedAt: z.iso.date(),
  finishedAt: z.iso.date().nullable(),
  status: z.string(),
  failReason: z.any().nullable(),
  agentRef: AgentRefSchema.nullable(),
  metadata: z.record(z.string(), z.any()).nullable(),
  manual: z.boolean(),
  sessionId: z.string(), // potential bloat
})

export type RunBase = z.infer<typeof RunBaseSchema>

export const StandardRunSchema = RunBaseSchema.extend({
  sessionItems: z.array(SessionItemSchema),
  channelMessages: z.array(ChannelMessageSchema),
});

// Auto-fetch run creation: just send the input
export const StandardRunCreateSchema = z.object({
  input: z.record(z.string(), z.any()),
});

export type StandardRunCreate = z.infer<typeof StandardRunCreateSchema>

// Manual run creation: full control over items, status, state, etc.
export const ManualRunCreateSchema = z.object({
  items: z.array(z.record(z.string(), z.any())),
  agent: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  status: z.enum(['in_progress', 'completed', 'cancelled', 'failed']).optional(),
  state: z.any().optional(),
  failReason: z.any().nullable().optional(),
});

export type ManualRunCreate = z.infer<typeof ManualRunCreateSchema>

// Manual run update
export const ManualRunUpdateSchema = z.object({
  items: z.array(z.record(z.string(), z.any())).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  status: z.enum(['in_progress', 'completed', 'cancelled', 'failed']).optional(),
  state: z.any().optional(),
  failReason: z.any().nullable().optional(),
  outputItemCount: z.number().int().min(0).optional(),
  channelReply: z.object({ text: z.string() }).optional(),
});

export type ManualRunUpdate = z.infer<typeof ManualRunUpdateSchema>

export type StandardRun = z.infer<typeof StandardRunSchema>

export const ChannelRefSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('api'), name: z.string() }),
  z.object({ type: z.enum(['gmail', 'mock']), address: z.string() }),
]);

export type ChannelRef = z.infer<typeof ChannelRefSchema>

export const SessionBaseSchema = z.object({
  id: z.string(),
  channel: ChannelRefSchema,
  handle: z.string(),
  createdAt: z.iso.date(),
  updatedAt: z.iso.date(),
  metadata: z.record(z.string(), z.any()).nullable(),
  user: UserSchema,
  userId: z.string(), // potential bloat
  space: SpaceSchema, // this is actually user.space, but allows to "think user-less"
  title: z.string().nullable(),
  agentRef: AgentRefSchema.nullable(),
  agentRefs: z.array(AgentRefSchema),
  active: z.boolean()
})

export type SessionBase = z.infer<typeof SessionBaseSchema>

export const StandardSessionSchema = SessionBaseSchema.extend({
  runs: z.array(StandardRunSchema),
  state: z.any().nullable().optional(),
})

export type StandardSession = z.infer<typeof StandardSessionSchema>


export const SessionCreateBaseSchema = z.object({
  agent: z.string(),
  initialState: z.any().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  userId: z.string().optional(),

  // // mandatory if userId is not provided -> determines destination space basically
  // space: SpaceSchema.optional(),
  // createdBy: z.string().optional(),

  title: z.string().nullish()
})

export const StandardSessionCreateSchema = SessionCreateBaseSchema.extend({
  input: z.any().optional(),
})

export type StandardSessionCreate = z.infer<typeof StandardSessionCreateSchema>


export const SessionUpdateSchema = z.object({
  metadata: SessionCreateBaseSchema.shape.metadata,
  title: SessionCreateBaseSchema.shape.title,
})

export type SessionUpdate = z.infer<typeof SessionUpdateSchema>

export const PublicSessionsGetQueryParamsSchema = z.object({
  page: z.union([z.number(), z.string()]).optional(),
  limit: z.union([z.number(), z.string()]).optional()
});

export const SessionsGetQueryParamsSchema = PublicSessionsGetQueryParamsSchema.extend({
  userId: z.string().optional(),
  space: SpaceSchema.optional(), // necessary if userId is not provided
})

export type PublicSessionsGetQueryParams = z.infer<typeof PublicSessionsGetQueryParamsSchema>
export type SessionsGetQueryParams = z.infer<typeof SessionsGetQueryParamsSchema>


export const OrganizationBaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string().nullable(),
  logo: z.string().nullable()
})

export type OrganizationBase = z.infer<typeof OrganizationBaseSchema>

// // member - user of organization, works in agentview panel, not end user
// export const MemberSchema = z.object({
//   id: z.string(),
//   email: z.string(),
//   name: z.string(),
//   role: z.string(),
//   image: z.string().nullable(),
//   createdAt: z.iso.date(),
// })

// export const MemberUpdateSchema = z.object({
//   role: z.enum(['admin', 'user']),
// })

// export type Member = z.infer<typeof MemberSchema>

// export type MemberUpdate = z.infer<typeof MemberUpdateSchema>





export const PaginationSchema = z.object({
  page: z.number(),
  limit: z.number(),
  totalPages: z.number(),
  totalCount: z.number(),
  hasNextPage: z.boolean(),
  hasPreviousPage: z.boolean(),
  currentPageStart: z.number(),
  currentPageEnd: z.number()
})

export type Pagination = z.infer<typeof PaginationSchema>

export const SessionsPaginatedResponseSchema = z.object({
  sessions: z.array(SessionBaseSchema),
  pagination: PaginationSchema,
})

export type SessionsPaginatedResponse = z.infer<typeof SessionsPaginatedResponseSchema>



// run webhook / agent endpoint body
export const RunBodySchema = z.object({
  session: StandardSessionSchema,
})

export type RunBody = z.infer<typeof RunBodySchema>

// Sessions stats query params
export const SessionsStatsQueryParamsSchema = SessionsGetQueryParamsSchema.extend({
  granular: z.boolean().optional(),
})

export type SessionsStatsQueryParams = z.infer<typeof SessionsStatsQueryParamsSchema>

// Sessions stats response
export type InboxItemStats = {
  sessionId: string
  runId: string | null
  sessionItemId: string | null
  channelMessageId: string | null
  unseenEvents: any[]
}

export type SessionStats = {
  inboxItems: InboxItemStats[]
}

export type SessionsStats = {
  unseenCount: number
  sessions?: Record<string, SessionStats>
}

// Run details response
export type RunDetails = {
  request?: any
  response?: any
}

// Watch session event
export type SessionStreamEvent = {
  type: string
  data: any
}

/**
 * AI SDK (default format)
 */

// todo: take this type from 'ai' lib

export const UIMessageSchema = z.object({ 
  id: z.string(),
  type: z.literal("message").optional(),
  role: z.enum(['user', 'assistant', 'system']),
  parts: z.array(z.any()),
  metadata: z.any().optional(),
})

export type UIMessage = z.infer<typeof UIMessageSchema>

export const UserUIMessageSchema = UIMessageSchema.extend({
  id: z.string().optional(),
  role: z.literal("user"),
})

export type UserUIMessage = z.infer<typeof UserUIMessageSchema>


export const RunSchema = StandardRunSchema;
export type Run = z.infer<typeof RunSchema>

export const SessionStatusSchema = z.enum(['in_progress', 'idle', 'cancelled', 'failed']);
export type SessionStatus = z.infer<typeof SessionStatusSchema>

export const SessionSchema = SessionBaseSchema.extend({
  messages: z.array(UIMessageSchema),
  resume: z.boolean(),
  status: SessionStatusSchema,
  failReason: z.any().nullable().optional(),
});

export type Session = z.infer<typeof SessionSchema>

export const SessionCreateSchema = SessionCreateBaseSchema.extend({
  input: UserUIMessageSchema.optional(),
  active: z.boolean().optional()
})


export type SessionCreate = z.infer<typeof SessionCreateSchema>


export const RunCreateSchema = z.object({
  input: UserUIMessageSchema,
  previousRunId: z.string().optional().nullable(), // null -> regenerate from zero. undefined -> just not defined
});

export type RunCreate = z.infer<typeof RunCreateSchema>

export const RunUpdateSchema = z.object({
  metadata: z.record(z.string(), z.any()).optional(),
});

export type RunUpdate = z.infer<typeof RunUpdateSchema>