import z from 'zod'

export const UserSchema = z.object({
    id: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
    name: z.string(),
    email: z.string(),
})

export type User = z.infer<typeof UserSchema>

export const InvitationSchema = z.object({
    id: z.string(),
    email: z.string(),
    role: z.string(),
    expiresAt: z.date(),
    createdAt: z.date(),
    status: z.string(),
    invitedBy: z.string().nullable(),
})

export const InvitationCreateSchema = z.object({
    email: z.string().email(),
    role: z.enum(['admin', 'user']),
})


export const VersionSchema = z.object({
    id: z.string(),
    version: z.string(),
    env: z.string(),
    metadata: z.any(),
    createdAt: z.date(),
})

export const ClientSchema = z.object({
    id: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
    simulatedBy: z.string().nullable(),
    isShared: z.boolean(),
})

export type Client = z.infer<typeof ClientSchema>

export const ClientCreateSchema = ClientSchema.pick({
    simulatedBy: true,
    isShared: true,
}).partial()

export type ClientCreate = z.infer<typeof ClientCreateSchema>

export const ScoreSchema = z.object({
    id: z.string(),
    sessionItemId: z.string(),

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


export const SessionItemSchema = z.object({
    id: z.string(),
    number: z.number(),
    createdAt: z.date(),
    updatedAt: z.date(),
    content: z.any(),
    sessionId: z.string(),
    type: z.string(),
    role: z.string().nullish(),
    commentMessages: z.array(CommentMessageSchema),
})

export type SessionItem = z.infer<typeof SessionItemSchema>

export const SessionItemCreateSchema = SessionItemSchema.pick({
    type: true,
    role: true,
    content: true,
})

export const RunSchema = z.object({
    id: z.string(),
    createdAt: z.date(),
    finishedAt: z.date().nullable(),
    sessionId: z.string(),
    versionId: z.string().nullable(),
    state: z.string(),
    failReason: z.any().nullable(),
    sessionItems: z.array(SessionItemSchema),
    version: VersionSchema.nullable(),
})

export type Run = z.infer<typeof RunSchema>

export const SessionSchema = z.object({
    id: z.string(),
    number: z.number(),
    createdAt: z.date(),
    updatedAt: z.date(),
    metadata: z.any(),
    clientId: z.string(),
    agent: z.string(),
    runs: z.array(RunSchema),
    client: ClientSchema,
})

export type Session = z.infer<typeof SessionSchema>

export const SessionCreateSchema = SessionSchema.pick({
    clientId: true,
    agent: true,
    metadata: true,
})

export const ScoreCreateSchema = ScoreSchema.pick({
    sessionItemId: true,
    name: true,
    value: true,
    commentId: true,
})

export const ConfigSchema = z.object({
    id: z.string(),
    config: z.any(),
    createdAt: z.date(),
    createdBy: z.string(),
})

export type Config = z.infer<typeof ConfigSchema>

export const ConfigCreateSchema = ConfigSchema.pick({
    config: true,
})

export const InboxItemSchema = z.any() // todo: fix this

export type InboxItem = z.infer<typeof InboxItemSchema>


export const MemberSchema = z.object({
    id: z.string(),
    email: z.string(),
    name: z.string().nullable(),
    role: z.string().nullable(),
    createdAt: z.date(),
})

export const MemberUpdateSchema = z.object({
    role: z.enum(['admin', 'user']),
})

export type Member = z.infer<typeof MemberSchema>

export type MemberUpdate = z.infer<typeof MemberUpdateSchema>

export const allowedSessionLists = ["real", "simulated_private", "simulated_shared"]