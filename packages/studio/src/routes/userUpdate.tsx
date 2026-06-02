import type { UserUpdate } from "agentview/apiTypes";
import { agentview, withErrorHandling } from "../lib/agentview";
import type { ActionFunctionArgs, RouteObject } from "react-router";

async function action({ request, params }: ActionFunctionArgs) {
  const formData = await request.formData();

  const update: UserUpdate = {};
  const shared = formData.get("shared");
  if (shared !== null) {
    update.shared = shared === "true";
  }

  return await withErrorHandling(() => agentview().users.update(params.userId!, update));
}

export const userUpdateRoute: RouteObject = {
  action,
}
