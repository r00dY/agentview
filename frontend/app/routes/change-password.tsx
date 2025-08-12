import type { Route } from "./+types/change-password";
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
    return { status: "error", error: { message: "Validation error", fieldErrors } };
  }

  try {
    const { data, error } = await authClient.changePassword({
      currentPassword: currentPassword.trim(),
      newPassword: newPassword.trim(),
    });
    if (error) {
      return { status: "error", error };
    }

    return { status: "success", data };
    
  } catch (error) {
    console.error('Error changing password:', error);
    if (error instanceof APIError) {
      return { status: "error", error: { message: error.message } };
    }

    return { status: "error", error: { message: 'An unexpected error occurred. Please try again.' } };
  }
} 