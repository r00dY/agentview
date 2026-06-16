import { agentview, withErrorHandling } from "../lib/agentview";
import { type ActionResponse } from "../lib/errors";
import type { ActionFunctionArgs, RouteObject } from "react-router";

async function action({ request, params }: ActionFunctionArgs): Promise<ActionResponse> {
    const commentId = params.commentId!;

    if (request.method === 'DELETE') {
        const body = await request.json();
        return await withErrorHandling(() =>
            agentview().comments.delete(commentId, { sessionId: body.sessionId })
        );
    }
    else if (request.method === 'PUT') {
        const body = await request.json();
        return await withErrorHandling(() =>
            agentview().comments.update(commentId, { content: body.comment }, { sessionId: body.sessionId })
        );
    }

    throw new Error('Method not allowed');
}

export const commentRoute: RouteObject = {
    action,
}
