import { agentview, withErrorHandling } from "../lib/agentview";
import { type ActionResponse } from "../lib/errors";
import type { ActionFunctionArgs, RouteObject } from "react-router";
import { actionContext } from "../actionContext";

async function action({ request, context }: ActionFunctionArgs): Promise<ActionResponse> {
    context.set(actionContext, { isAction: true });

    const body = await request.json();
    const { content, ...target } = body;

    if (!content) {
        return {
            ok: false,
            error: {
                message: "Comment content is required",
            }
        };
    }

    return await withErrorHandling(() =>
        agentview().createComment({ ...target, content })
    );
}

export const commentsRoute: RouteObject = {
    action,
}
