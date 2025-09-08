import type { Route } from "./+types/user";
import { type ActionResponse, betterAuthErrorToBaseError } from "~/lib/errors";
import { authClient } from "~/lib/auth-client";

export async function clientAction({
  request,
}: Route.ActionArgs): Promise<ActionResponse> {

  const fieldErrors: Record<string, string> = {};

  // Parse form data
  const formData = await request.formData();
  const name = formData.get('name') as string;

  // Validate the name field
  if (!name || name.trim().length === 0) {
    fieldErrors.name = 'Name is required.';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, error: { message: "Validation error", fieldErrors } };
  }

  const { data, error } = await authClient.updateUser({
    name: name.trim(),
  });
  if (error) {
    return { ok: false, error: betterAuthErrorToBaseError(error) };
  }

  return { ok: true, data };
}
