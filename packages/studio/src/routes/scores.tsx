import { agentview, withErrorHandling } from "../lib/agentview";
import { type ActionResponse } from "../lib/errors";
import type { ActionFunctionArgs, RouteObject } from "react-router";

async function action({ request }: ActionFunctionArgs): Promise<ActionResponse> {
    if (request.method !== 'PATCH') {
        throw new Error('Method not allowed');
    }

    const body = await request.json();
    const { scores, ...target } = body;

    return await withErrorHandling(() =>
        // agentview().updateScores({ ...target, scores })
        agentview().scores.update({ ...target, scores })
    );
}

export const scoresRoute: RouteObject = {
    action,
}
