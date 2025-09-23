import { type Session } from "./apiTypes";
export declare function getLastRun(session: Session): {
    id: string;
    created_at: Date;
    finished_at: Date | null;
    session_id: string;
    version_id: string | null;
    state: string;
    fail_reason: any;
    sessionItems: {
        id: string;
        number: number;
        created_at: Date;
        updated_at: Date;
        content: any;
        session_id: string;
        type: string;
        commentMessages: {
            id: string;
            userId: string;
            content: string | null;
            createdAt: Date;
            updatedAt: Date | null;
            deletedAt: Date | null;
            deletedBy: string | null;
            scores: {
                id: string;
                sessionItemId: string;
                name: string;
                value: any;
                commentId: string | null;
                createdBy: string;
                createdAt: Date;
                updatedAt: Date;
                deletedAt: Date | null;
                deletedBy: string | null;
            }[] | null;
        }[];
        role?: string | null | undefined;
    }[];
    version: {
        id: string;
        version: string;
        env: string;
        metadata: any;
        created_at: Date;
    } | null;
} | undefined;
export declare function getActiveRuns(session: Session): {
    id: string;
    created_at: Date;
    finished_at: Date | null;
    session_id: string;
    version_id: string | null;
    state: string;
    fail_reason: any;
    sessionItems: {
        id: string;
        number: number;
        created_at: Date;
        updated_at: Date;
        content: any;
        session_id: string;
        type: string;
        commentMessages: {
            id: string;
            userId: string;
            content: string | null;
            createdAt: Date;
            updatedAt: Date | null;
            deletedAt: Date | null;
            deletedBy: string | null;
            scores: {
                id: string;
                sessionItemId: string;
                name: string;
                value: any;
                commentId: string | null;
                createdBy: string;
                createdAt: Date;
                updatedAt: Date;
                deletedAt: Date | null;
                deletedBy: string | null;
            }[] | null;
        }[];
        role?: string | null | undefined;
    }[];
    version: {
        id: string;
        version: string;
        env: string;
        metadata: any;
        created_at: Date;
    } | null;
}[];
export declare function getAllSessionItems(session: Session, options?: {
    activeOnly?: boolean;
}): {
    id: string;
    number: number;
    created_at: Date;
    updated_at: Date;
    content: any;
    session_id: string;
    type: string;
    commentMessages: {
        id: string;
        userId: string;
        content: string | null;
        createdAt: Date;
        updatedAt: Date | null;
        deletedAt: Date | null;
        deletedBy: string | null;
        scores: {
            id: string;
            sessionItemId: string;
            name: string;
            value: any;
            commentId: string | null;
            createdBy: string;
            createdAt: Date;
            updatedAt: Date;
            deletedAt: Date | null;
            deletedBy: string | null;
        }[] | null;
    }[];
    role?: string | null | undefined;
}[];
export declare function getVersions(session: Session): ({
    id: string;
    version: string;
    env: string;
    metadata: any;
    created_at: Date;
} | null)[];
//# sourceMappingURL=sessionUtils.d.ts.map