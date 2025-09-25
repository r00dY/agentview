import z from 'zod'


export const ClientSchema = z.object({
    id: z.string(),
    createdAt: z.iso.date(),
    updatedAt: z.iso.date(),
    simulatedBy: z.string().nullable(),
    isShared: z.boolean(),
})

export type Client = z.infer<typeof ClientSchema>

export const ClientCreateSchema = ClientSchema.pick({
    isShared: true,
}).partial()

export type ClientCreate = z.infer<typeof ClientCreateSchema>


// export const UserSchema = z.object({
//     id: z.string(),
//     createdAt: z.iso.date(),
//     updatedAt: z.iso.date(),
//     name: z.string(),
//     email: z.string(),
// })

// export type User = z.infer<typeof UserSchema>

export const InvitationSchema = z.object({
    id: z.string(),
    email: z.string(),
    role: z.string(),
    expiresAt: z.iso.date(),
    createdAt: z.iso.date(),
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
    createdAt: z.iso.date(),
})

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

export const CommentMessageSchema = z.object({
    id: z.string(),
    userId: z.string(),
    content: z.string().nullable(),
    createdAt: z.iso.date(),
    updatedAt: z.iso.date().nullable(),
    deletedAt: z.iso.date().nullable(),
    deletedBy: z.string().nullable(),
    scores: z.array(ScoreSchema).nullable(),
})

export type CommentMessage = z.infer<typeof CommentMessageSchema>

export const SessionItemSchema = z.object({
    id: z.string(),
    number: z.number(),
    createdAt: z.iso.date(),
    updatedAt: z.iso.date(),
    content: z.any(),
    sessionId: z.string(),
    type: z.string(),
    role: z.string().nullable(),
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
    createdAt: z.iso.date(),
    finishedAt: z.iso.date().nullable(),
    sessionId: z.string(),
    versionId: z.string().nullable(),
    state: z.string(),
    failReason: z.any().nullable(),
    responseData: z.any().nullable(),
    sessionItems: z.array(SessionItemSchema),
    version: VersionSchema.nullable(),
})

export type Run = z.infer<typeof RunSchema>

export const SessionSchema = z.object({
    id: z.string(),
    number: z.number(),
    createdAt: z.iso.date(),
    updatedAt: z.iso.date(),
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
    createdAt: z.iso.date(),
    createdBy: z.string(),
})

export type Config = z.infer<typeof ConfigSchema>

export const ConfigCreateSchema = ConfigSchema.pick({
    config: true,
})

export const InboxItemSchema = z.any() // todo: fix this

export type InboxItem = z.infer<typeof InboxItemSchema>


export const UserSchema = z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    role: z.string(),
    createdAt: z.iso.date(),
})

export const UserUpdateSchema = z.object({
    role: z.enum(['admin', 'user']),
})

export type User = z.infer<typeof UserSchema>

export type UserUpdate = z.infer<typeof UserUpdateSchema>

export const allowedSessionLists = ["real", "simulated_private", "simulated_shared"]