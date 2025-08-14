import z from 'zod'

// export const UserSchema = z.object({
//     id: z.string(),
//     created_at: z.date(),
//     updated_at: z.date(),
//     name: z.string(),
//     email: z.string(),
// })

export const ClientSchema = z.object({
    id: z.string(),
    created_at: z.date(),
    updated_at: z.date(),
    simulatedBy: z.any().nullable(),
})

export const CommentMessageSchema = z.object({
    id: z.string(),
    commentThreadId: z.string(),
    userId: z.string(),
    content: z.string(),
    createdAt: z.date(),
    updatedAt: z.date().nullable(),
    deletedAt: z.date().nullable(),
    deletedBy: z.string().nullable(),
})

export const CommentThreadSchema = z.object({
    id: z.string(),
    activityId: z.string(),
    commentMessages: z.array(CommentMessageSchema),
})


export const ActivitySchema = z.object({
    id: z.string(),
    created_at: z.date(),
    updated_at: z.date(),
    content: z.any(),
    thread_id: z.string(),
    type: z.string(),
    role: z.string(),
    commentThread: z.optional(CommentThreadSchema),
})

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
})

export const ThreadSchema = z.object({
    id: z.string(),
    created_at: z.date(),
    updated_at: z.date(),
    metadata: z.any(),
    client_id: z.string(),
    type: z.string(),
    runs: z.array(RunSchema),
    client: ClientSchema,
})

export const ThreadCreateSchema = ThreadSchema.pick({
    client_id: true,
    type: true,
    metadata: true,
})

