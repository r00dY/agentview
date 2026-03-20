import type { Space } from "agentview/apiTypes";
import { agentview, withErrorHandling } from "../lib/agentview";
import type { ActionFunctionArgs, RouteObject } from "react-router";

async function action({ request, params }: ActionFunctionArgs) {
  const formData = await request.formData();

  const space = formData.get("space") as Space;

  return await withErrorHandling(() => agentview().updateUser({ id: params.userId!, space }));
}

export const userUpdateRoute: RouteObject = {
  action,
}
