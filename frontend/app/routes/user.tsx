import type { Route } from "./+types/user";
import { auth } from "../../lib/auth.server";
import { APIError } from "better-auth/api";
import type { FormActionData, FormActionDataError } from "~/lib/FormActionData";
import { data } from "react-router";

export async function action({
  request,
}: Route.ActionArgs) {

  const fieldErrors: FormActionDataError['fieldErrors'] = {};

  // Get the current session to verify the user is logged in
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session) {
    return { error: 'You must be logged in to update your profile.' };
  }

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
    await auth.api.updateUser({
      headers: request.headers,
      body: {
        name: name.trim(),
      },
    });

    return data({ status: "success" }, {
      status: 200,
    })
    
  } catch (error) {
    console.error('Error updating user:', error);
    if (error instanceof APIError) {
      return data({ status: "error", error: error.message }, {
        status: 400,
      })
    }

    return data({ status: "error", error: 'An unexpected error occurred. Please try again.' }, {
      status: 400,
    })
  }
}
