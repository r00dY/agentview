import z from 'zod';
export const UserSchema = z.object({
    id: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
    name: z.string(),
    email: z.string(),
});
export const VersionSchema = z.object({
    id: z.string(),
    version: z.string(),
    env: z.string(),
    metadata: z.any(),
    created_at: z.date(),
});
export const ClientSchema = z.object({
    id: z.string(),
    created_at: z.date(),
    updated_at: z.date(),
    simulated_by: z.string().nullable(),
    is_shared: z.boolean(),
});
export const ClientCreateSchema = ClientSchema.pick({
    simulated_by: true,
    is_shared: true,
}).partial();
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
});
export const CommentMessageSchema = z.object({
    id: z.string(),
    userId: z.string(),
    content: z.string().nullable(),
    createdAt: z.date(),
    updatedAt: z.date().nullable(),
    deletedAt: z.date().nullable(),
    deletedBy: z.string().nullable(),
    scores: z.array(ScoreSchema).nullable(),
});
export const SessionItemSchema = z.object({
    id: z.string(),
    number: z.number(),
    created_at: z.date(),
    updated_at: z.date(),
    content: z.any(),
    session_id: z.string(),
    type: z.string(),
    role: z.string().nullish(),
    commentMessages: z.array(CommentMessageSchema),
});
export const SessionItemCreateSchema = SessionItemSchema.pick({
    type: true,
    role: true,
    content: true,
});
export const RunSchema = z.object({
    id: z.string(),
    created_at: z.date(),
    finished_at: z.date().nullable(),
    session_id: z.string(),
    version_id: z.string().nullable(),
    state: z.string(),
    fail_reason: z.any().nullable(),
    sessionItems: z.array(SessionItemSchema),
    version: VersionSchema.nullable(),
});
export const SessionSchema = z.object({
    id: z.string(),
    number: z.number(),
    created_at: z.date(),
    updated_at: z.date(),
    metadata: z.any(),
    client_id: z.string(),
    type: z.string(),
    runs: z.array(RunSchema),
    client: ClientSchema,
});
export const SessionCreateSchema = SessionSchema.pick({
    client_id: true,
    type: true,
    metadata: true,
});
export const ScoreCreateSchema = ScoreSchema.pick({
    sessionItemId: true,
    name: true,
    value: true,
    commentId: true,
});
export const ConfigSchema = z.object({
    id: z.string(),
    config: z.any(),
    createdAt: z.date(),
    createdBy: z.string(),
});
export const ConfigCreateSchema = ConfigSchema.pick({
    config: true,
});
export const InboxItemSchema = z.any(); // todo: fix this
export const MemberSchema = z.object({
    id: z.string(),
    email: z.string(),
    name: z.string().nullable(),
    role: z.string().nullable(),
    created_at: z.date(),
});
export const MemberUpdateSchema = z.object({
    role: z.enum(['admin', 'user']),
});
export const SessionListSchema = z.object({
    name: z.string(),
    agent: z.string(),
    unseenCount: z.number(),
    hasMentions: z.boolean(),
});
//# sourceMappingURL=apiTypes.js.map