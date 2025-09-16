import z from 'zod'

export const UserSchema = z.object({
    id: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
    name: z.string(),
    email: z.string(),
})

export type User = z.infer<typeof UserSchema>

export const VersionSchema = z.object({
    id: z.string(),
    version: z.string(),
    env: z.string(),
    metadata: z.any(),
    created_at: z.date(),
})

export const ClientSchema = z.object({
    id: z.string(),
    created_at: z.date(),
    updated_at: z.date(),
    simulated_by: z.string().nullable(),
    is_shared: z.boolean(),
})

export type Client = z.infer<typeof ClientSchema>

export const ClientCreateSchema = ClientSchema.pick({
    simulated_by: true,
    is_shared: true,
}).partial()

export type ClientCreate = z.infer<typeof ClientCreateSchema>





export const ScoreSchema = z.object({
    id: z.string(),
    activityId: z.string(),

    name: z.string(),
    value: z.any(),
    commentId: z.string().nullable(),

    createdBy: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
    deletedAt: z.date().nullable(),
    deletedBy: z.string().nullable(),
})

export type Score = z.infer<typeof ScoreSchema>

export const CommentMessageSchema = z.object({
    id: z.string(),
    userId: z.string(),
    content: z.string().nullable(),
    createdAt: z.date(),
    updatedAt: z.date().nullable(),
    deletedAt: z.date().nullable(),
    deletedBy: z.string().nullable(),
    scores: z.array(ScoreSchema).nullable(),
})

export type CommentMessage = z.infer<typeof CommentMessageSchema>


export const ActivitySchema = z.object({
    id: z.string(),
    number: z.number(),
    created_at: z.date(),
    updated_at: z.date(),
    content: z.any(),
    thread_id: z.string(),
    type: z.string(),
    role: z.string().optional(),
    commentMessages: z.array(CommentMessageSchema),
})

export type Activity = z.infer<typeof ActivitySchema>

export const ActivityCreateSchema = ActivitySchema.pick({
    type: true,
    role: true,
    content: true,
})

export const RunSchema = z.object({
    id: z.string(),
    created_at: z.date(),
    finished_at: z.date().nullable(),
    thread_id: z.string(),
    version_id: z.string().nullable(),
    state: z.string(),
    fail_reason: z.any().nullable(),
    activities: z.array(ActivitySchema),
    version: VersionSchema.nullable(),
})

export type Run = z.infer<typeof RunSchema>

export const ThreadSchema = z.object({
    id: z.string(),
    number: z.number(),
    created_at: z.date(),
    updated_at: z.date(),
    metadata: z.any(),
    client_id: z.string(),
    type: z.string(),
    runs: z.array(RunSchema),
    client: ClientSchema,
})

export type Thread = z.infer<typeof ThreadSchema>

export const ThreadCreateSchema = ThreadSchema.pick({
    client_id: true,
    type: true,
    metadata: true,
})

export const ScoreCreateSchema = ScoreSchema.pick({
    activityId: true,
    name: true,
    value: true,
    commentId: true,
})

export const SchemaSchema = z.object({
    id: z.string(),
    schema: z.any(),
    createdAt: z.date(),
    createdBy: z.string(),
})

export type Schema = z.infer<typeof SchemaSchema>

export const SchemaCreateSchema = SchemaSchema.pick({
    schema: true,
})

export const InboxItemSchema = z.any() // todo: fix this
  
export type InboxItem = z.infer<typeof InboxItemSchema>


export const MemberSchema = z.object({
    id: z.string(),
    email: z.string(),
    name: z.string().nullable(),
    role: z.string().nullable(),
    created_at: z.date(),
  })
  
  export const MemberUpdateSchema = z.object({
    role: z.enum(['admin', 'user']),
  })
  
  export type Member = z.infer<typeof MemberSchema>

  export type MemberUpdate = z.infer<typeof MemberUpdateSchema>


export const SessionListSchema = z.object({
    name: z.string(),
    threadType: z.string(),
    unseenCount: z.number(),
    hasMentions: z.boolean(),
})

export type SessionList = z.infer<typeof SessionListSchema>