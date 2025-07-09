import type { Route } from "./+types/change-password";
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
    return { error: 'You must be logged in to change your password.' };
  }

  // Parse form data
  const formData = await request.formData();
  const currentPassword = formData.get('currentPassword') as string;
  const newPassword = formData.get('newPassword') as string;
  const confirmPassword = formData.get('confirmPassword') as string;

  // Validate the current password field
  if (!currentPassword || currentPassword.trim().length === 0) {
    fieldErrors.currentPassword = 'Current password is required.';
  }

  // Validate the new password field
  if (!newPassword || newPassword.trim().length === 0) {
    fieldErrors.newPassword = 'New password is required.';
  } else if (newPassword.length < 8) {
    fieldErrors.newPassword = 'New password must be at least 8 characters long.';
  }

  // Validate the confirm password field
  if (!confirmPassword || confirmPassword.trim().length === 0) {
    fieldErrors.confirmPassword = 'Please confirm your new password.';
  } else if (newPassword !== confirmPassword) {
    fieldErrors.confirmPassword = 'Passwords do not match.';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return data({ status: "error", fieldErrors }, {
      status: 400,
    })
  }

  try {
    await auth.api.changePassword({
      headers: request.headers,
      body: {
        currentPassword: currentPassword.trim(),
        newPassword: newPassword.trim(),
      },
    });

    return data({ status: "success" }, {
      status: 200,
    })
    
  } catch (error) {
    console.error('Error changing password:', error);
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