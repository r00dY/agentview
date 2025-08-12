import type { Route } from "./+types/user";
import { APIError } from "better-auth/api";
import type { FormActionData, FormActionDataError } from "~/lib/FormActionData";
import { data } from "react-router";
import { authClient } from "~/lib/auth-client";

export async function clientAction({
  request,
}: Route.ActionArgs) {

  const fieldErrors: FormActionDataError['error']['fieldErrors'] = {};

  // Parse form data
  const formData = await request.formData();
  const name = formData.get('name') as string;

  // Validate the name field
  if (!name || name.trim().length === 0) {
    fieldErrors.name = 'Name is required.';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return data({ status: "error", fieldErrors }, {
      status: 400,
    })
  }

  try {
    const { data, error } = await authClient.updateUser({
      name: name.trim(),
    });
    if (error) {
      return { status: "error", error };
    }

    return { status: "success", data };
    
  } catch (error) {
    if (error instanceof APIError) {
      return { status: "error", error: { message: error.message } };
    }

    return { status: "error", error: { message: 'An unexpected error occurred. Please try again.' } };
  }
}
