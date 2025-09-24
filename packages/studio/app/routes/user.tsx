import { type ActionResponse, betterAuthErrorToBaseError } from "~/lib/errors";
import { authClient } from "~/lib/auth-client";
import type { RouteObject } from "react-router";

async function action({
  request,
}: { request: Request }): Promise<ActionResponse> {

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

function Component() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">User Profile</h1>
      <p>User profile page content goes here.</p>
    </div>
  );
}

export const userRoute: RouteObject = {
  Component,
  action,
}
