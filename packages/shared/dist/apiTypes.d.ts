import z from 'zod';
export declare const UserSchema: z.ZodObject<{
    id: z.ZodString;
    createdAt: z.ZodDate;
    updatedAt: z.ZodDate;
    name: z.ZodString;
    email: z.ZodString;
}, z.core.$strip>;
export type User = z.infer<typeof UserSchema>;
export declare const VersionSchema: z.ZodObject<{
    id: z.ZodString;
    version: z.ZodString;
    env: z.ZodString;
    metadata: z.ZodAny;
    created_at: z.ZodDate;
}, z.core.$strip>;
export declare const ClientSchema: z.ZodObject<{
    id: z.ZodString;
    created_at: z.ZodDate;
    updated_at: z.ZodDate;
    simulated_by: z.ZodNullable<z.ZodString>;
    is_shared: z.ZodBoolean;
}, z.core.$strip>;
export type Client = z.infer<typeof ClientSchema>;
export declare const ClientCreateSchema: z.ZodObject<{
    simulated_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    is_shared: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type ClientCreate = z.infer<typeof ClientCreateSchema>;
export declare const ScoreSchema: z.ZodObject<{
    id: z.ZodString;
    sessionItemId: z.ZodString;
    name: z.ZodString;
    value: z.ZodAny;
    commentId: z.ZodNullable<z.ZodString>;
    createdBy: z.ZodString;
    createdAt: z.ZodDate;
    updatedAt: z.ZodDate;
    deletedAt: z.ZodNullable<z.ZodDate>;
    deletedBy: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export type Score = z.infer<typeof ScoreSchema>;
export declare const CommentMessageSchema: z.ZodObject<{
    id: z.ZodString;
    userId: z.ZodString;
    content: z.ZodNullable<z.ZodString>;
    createdAt: z.ZodDate;
    updatedAt: z.ZodNullable<z.ZodDate>;
    deletedAt: z.ZodNullable<z.ZodDate>;
    deletedBy: z.ZodNullable<z.ZodString>;
    scores: z.ZodNullable<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        sessionItemId: z.ZodString;
        name: z.ZodString;
        value: z.ZodAny;
        commentId: z.ZodNullable<z.ZodString>;
        createdBy: z.ZodString;
        createdAt: z.ZodDate;
        updatedAt: z.ZodDate;
        deletedAt: z.ZodNullable<z.ZodDate>;
        deletedBy: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type CommentMessage = z.infer<typeof CommentMessageSchema>;
export declare const SessionItemSchema: z.ZodObject<{
    id: z.ZodString;
    number: z.ZodNumber;
    created_at: z.ZodDate;
    updated_at: z.ZodDate;
    content: z.ZodAny;
    session_id: z.ZodString;
    type: z.ZodString;
    role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    commentMessages: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        userId: z.ZodString;
        content: z.ZodNullable<z.ZodString>;
        createdAt: z.ZodDate;
        updatedAt: z.ZodNullable<z.ZodDate>;
        deletedAt: z.ZodNullable<z.ZodDate>;
        deletedBy: z.ZodNullable<z.ZodString>;
        scores: z.ZodNullable<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            sessionItemId: z.ZodString;
            name: z.ZodString;
            value: z.ZodAny;
            commentId: z.ZodNullable<z.ZodString>;
            createdBy: z.ZodString;
            createdAt: z.ZodDate;
            updatedAt: z.ZodDate;
            deletedAt: z.ZodNullable<z.ZodDate>;
            deletedBy: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type SessionItem = z.infer<typeof SessionItemSchema>;
export declare const SessionItemCreateSchema: z.ZodObject<{
    content: z.ZodAny;
    type: z.ZodString;
    role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export declare const RunSchema: z.ZodObject<{
    id: z.ZodString;
    created_at: z.ZodDate;
    finished_at: z.ZodNullable<z.ZodDate>;
    session_id: z.ZodString;
    version_id: z.ZodNullable<z.ZodString>;
    state: z.ZodString;
    fail_reason: z.ZodNullable<z.ZodAny>;
    sessionItems: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        number: z.ZodNumber;
        created_at: z.ZodDate;
        updated_at: z.ZodDate;
        content: z.ZodAny;
        session_id: z.ZodString;
        type: z.ZodString;
        role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        commentMessages: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            userId: z.ZodString;
            content: z.ZodNullable<z.ZodString>;
            createdAt: z.ZodDate;
            updatedAt: z.ZodNullable<z.ZodDate>;
            deletedAt: z.ZodNullable<z.ZodDate>;
            deletedBy: z.ZodNullable<z.ZodString>;
            scores: z.ZodNullable<z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                sessionItemId: z.ZodString;
                name: z.ZodString;
                value: z.ZodAny;
                commentId: z.ZodNullable<z.ZodString>;
                createdBy: z.ZodString;
                createdAt: z.ZodDate;
                updatedAt: z.ZodDate;
                deletedAt: z.ZodNullable<z.ZodDate>;
                deletedBy: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    version: z.ZodNullable<z.ZodObject<{
        id: z.ZodString;
        version: z.ZodString;
        env: z.ZodString;
        metadata: z.ZodAny;
        created_at: z.ZodDate;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type Run = z.infer<typeof RunSchema>;
export declare const SessionSchema: z.ZodObject<{
    id: z.ZodString;
    number: z.ZodNumber;
    created_at: z.ZodDate;
    updated_at: z.ZodDate;
    metadata: z.ZodAny;
    client_id: z.ZodString;
    type: z.ZodString;
    runs: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        created_at: z.ZodDate;
        finished_at: z.ZodNullable<z.ZodDate>;
        session_id: z.ZodString;
        version_id: z.ZodNullable<z.ZodString>;
        state: z.ZodString;
        fail_reason: z.ZodNullable<z.ZodAny>;
        sessionItems: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            number: z.ZodNumber;
            created_at: z.ZodDate;
            updated_at: z.ZodDate;
            content: z.ZodAny;
            session_id: z.ZodString;
            type: z.ZodString;
            role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            commentMessages: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                userId: z.ZodString;
                content: z.ZodNullable<z.ZodString>;
                createdAt: z.ZodDate;
                updatedAt: z.ZodNullable<z.ZodDate>;
                deletedAt: z.ZodNullable<z.ZodDate>;
                deletedBy: z.ZodNullable<z.ZodString>;
                scores: z.ZodNullable<z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    sessionItemId: z.ZodString;
                    name: z.ZodString;
                    value: z.ZodAny;
                    commentId: z.ZodNullable<z.ZodString>;
                    createdBy: z.ZodString;
                    createdAt: z.ZodDate;
                    updatedAt: z.ZodDate;
                    deletedAt: z.ZodNullable<z.ZodDate>;
                    deletedBy: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        version: z.ZodNullable<z.ZodObject<{
            id: z.ZodString;
            version: z.ZodString;
            env: z.ZodString;
            metadata: z.ZodAny;
            created_at: z.ZodDate;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    client: z.ZodObject<{
        id: z.ZodString;
        created_at: z.ZodDate;
        updated_at: z.ZodDate;
        simulated_by: z.ZodNullable<z.ZodString>;
        is_shared: z.ZodBoolean;
    }, z.core.$strip>;
}, z.core.$strip>;
export type Session = z.infer<typeof SessionSchema>;
export declare const SessionCreateSchema: z.ZodObject<{
    metadata: z.ZodAny;
    type: z.ZodString;
    client_id: z.ZodString;
}, z.core.$strip>;
export declare const ScoreCreateSchema: z.ZodObject<{
    name: z.ZodString;
    sessionItemId: z.ZodString;
    value: z.ZodAny;
    commentId: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const ConfigSchema: z.ZodObject<{
    id: z.ZodString;
    config: z.ZodAny;
    createdAt: z.ZodDate;
    createdBy: z.ZodString;
}, z.core.$strip>;
export type Config = z.infer<typeof ConfigSchema>;
export declare const ConfigCreateSchema: z.ZodObject<{
    config: z.ZodAny;
}, z.core.$strip>;
export declare const InboxItemSchema: z.ZodAny;
export type InboxItem = z.infer<typeof InboxItemSchema>;
export declare const MemberSchema: z.ZodObject<{
    id: z.ZodString;
    email: z.ZodString;
    name: z.ZodNullable<z.ZodString>;
    role: z.ZodNullable<z.ZodString>;
    created_at: z.ZodDate;
}, z.core.$strip>;
export declare const MemberUpdateSchema: z.ZodObject<{
    role: z.ZodEnum<{
        admin: "admin";
        user: "user";
    }>;
}, z.core.$strip>;
export type Member = z.infer<typeof MemberSchema>;
export type MemberUpdate = z.infer<typeof MemberUpdateSchema>;
export declare const SessionListSchema: z.ZodObject<{
    name: z.ZodString;
    agent: z.ZodString;
    unseenCount: z.ZodNumber;
    hasMentions: z.ZodBoolean;
}, z.core.$strip>;
export type SessionList = z.infer<typeof SessionListSchema>;
//# sourceMappingURL=apiTypes.d.ts.map