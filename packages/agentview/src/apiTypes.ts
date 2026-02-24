import { z } from 'zod'

export const spaceAllowedValues = ['production', 'playground', 'shared-playground'] as const;


export const SpaceSchema = z.enum(spaceAllowedValues);
export type Space = z.infer<typeof SpaceSchema>

export const UserSchema = z.object({
  id: z.string(),
  externalId: z.string().nullable(),
  email: z.string().nullable(),
  createdAt: z.iso.date(),
  updatedAt: z.iso.date(),
  createdBy: z.string().nullable(),
  space: SpaceSchema,
  token: z.string(),
})

export type User = z.infer<typeof UserSchema>

export const UserCreateSchema = UserSchema.pick({
  externalId: true,
  email: true,
  space: true, // default -> playground
}).partial()

export type UserCreate = z.infer<typeof UserCreateSchema>

export const ScoreSchema = z.object({
  id: z.string(),
  sessionItemId: z.string(),

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
  sessionItemId: z.string(),
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



export const SessionItemSchema = z.object({
  id: z.string(),
  createdAt: z.iso.date(),
  updatedAt: z.iso.date(),
  // type: z.string(),
  // role: z.string().nullable(),
  content: z.any(),

  runId: z.string(), // potential bloat
  sessionId: z.string(), // potential bloat
})

export type SessionItem = z.infer<typeof SessionItemSchema>


export const RunSchema = z.object({
  id: z.string(),
  createdAt: z.iso.date(),
  updatedAt: z.iso.date(),
  finishedAt: z.iso.date().nullable(),
  status: z.string(),
  failReason: z.any().nullable(),
  version: z.string().nullable(),
  metadata: z.record(z.string(), z.any()).nullable(),
  sessionItems: z.array(SessionItemSchema),

  sessionId: z.string(), // potential bloat
  versionId: z.string().nullable(), // potential bloat
})

export const RunCreateSchema = z.object({
  sessionId: z.string(),
  items: z.array(z.record(z.string(), z.any())),
  version: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  status: z.enum(['in_progress', 'completed', 'cancelled', 'failed']).optional(),
  state: z.any().optional(),
  failReason: z.any().nullable().optional()
});

export type RunCreate = z.infer<typeof RunCreateSchema>

export const RunUpdateSchema = RunCreateSchema.pick({
  items: true,
  metadata: true,
  status: true,
  state: true,
  failReason: true
}).partial()

export type RunUpdate = z.infer<typeof RunUpdateSchema>

export type Run = z.infer<typeof RunSchema>

export const SessionBaseSchema = z.object({
  id: z.string(),
  agent: z.string(),
  handle: z.string(),
  createdAt: z.iso.date(),
  updatedAt: z.iso.date(),
  metadata: z.record(z.string(), z.any()).nullable(),
  user: UserSchema,
  userId: z.string(), // potential bloat
  space: SpaceSchema, // this is actually user.space, but allows to "think user-less"
  state: z.any().nullable().optional(),
  summary: z.string().nullable(),
  versions: z.array(z.string()),
})

export type SessionBase = z.infer<typeof SessionBaseSchema>

export const SessionSchema = SessionBaseSchema.extend({
  runs: z.array(RunSchema),
})

export type Session = z.infer<typeof SessionSchema>


export const SessionCreateSchema = z.object({
  agent: z.string(),
  metadata: z.record(z.string(), z.any()).optional(),
  userId: z.string().optional(),
  space: SpaceSchema.optional(), // necessary if userId is not provided
  summary: z.string().nullish(),
})

export type SessionCreate = z.infer<typeof SessionCreateSchema>

export const SessionUpdateSchema = z.object({
  metadata: SessionCreateSchema.shape.metadata,
  summary: SessionCreateSchema.shape.summary,
})

export type SessionUpdate = z.infer<typeof SessionUpdateSchema>

export const PublicSessionsGetQueryParamsSchema = z.object({
  agent: z.string().optional(),
  page: z.union([z.number(), z.string()]).optional(),
  limit: z.union([z.number(), z.string()]).optional()
});

export const SessionsGetQueryParamsSchema = PublicSessionsGetQueryParamsSchema.extend({
  userId: z.string().optional(),
  space: SpaceSchema.optional(), // necessary if userId is not provided
  // starred: z.union([z.boolean(), z.literal('true'), z.literal('false')]).optional(),
})

export type PublicSessionsGetQueryParams = z.infer<typeof PublicSessionsGetQueryParamsSchema>
export type SessionsGetQueryParams = z.infer<typeof SessionsGetQueryParamsSchema>

export const EnvironmentBaseSchema = z.object({
  id: z.string(),
  // userId: z.string().nullable(), // null = production config, string = user's dev config
  // name: z.string(),
  createdAt: z.iso.date(),
  user: z.any()
})

export type EnvironmentBase = z.infer<typeof EnvironmentBaseSchema>

export const EnvironmentSchema = EnvironmentBaseSchema.extend({
  config: z.any(),
})

export type Environment = z.infer<typeof EnvironmentSchema>

export const EnvironmentCreateSchema = z.object({
  config: z.any(),
})

export type EnvironmentCreate = z.infer<typeof EnvironmentCreateSchema>

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


// Channels

export const ChannelSchema = z.object({
  id: z.string(),
  type: z.string(),
  address: z.string(),
  status: z.string(),
  environment: EnvironmentBaseSchema.nullable(),
  agent: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Channel = z.infer<typeof ChannelSchema>

export const ChannelMessageSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  channelThreadId: z.string(),
  direction: z.string(),
  sourceId: z.string().nullable(),
  text: z.string().nullable(),
  attachments: z.any().nullable(),
  providerData: z.any().nullable(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type ChannelMessage = z.infer<typeof ChannelMessageSchema>

export const ChannelThreadSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  channelId: z.string(),
  sourceThreadId: z.string().nullable(),
  contact: z.string(),
  contactKind: z.string(),
  status: z.string(),
  messages: z.array(ChannelMessageSchema).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type ChannelThread = z.infer<typeof ChannelThreadSchema>

// run webhook / agent endpoint body
export const RunBodySchema = z.object({
  session: SessionSchema,
})

export type RunBody = z.infer<typeof RunBodySchema>

// Sessions stats query params
export const SessionsStatsQueryParamsSchema = SessionsGetQueryParamsSchema.extend({
  granular: z.boolean().optional(),
})

export type SessionsStatsQueryParams = z.infer<typeof SessionsStatsQueryParamsSchema>

// Sessions stats response
export type SessionsStats = {
  unseenCount: number
  hasMentions: boolean
  sessions?: Record<string, { unseenEvents: any[], items: Record<string, { unseenEvents: any[] }> }>
  items?: Record<string, any>
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
