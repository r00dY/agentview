import type { Route } from "./+types/change-password";
import { authClient } from "~/lib/auth-client";
import { type ActionResponse, betterAuthErrorToBaseError } from "~/lib/errors";

export async function clientAction({
  request,
}: Route.ActionArgs): Promise<ActionResponse> {

  const fieldErrors: Record<string, string> = {};

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
    return { ok: false, error: { message: "Validation error", fieldErrors } };
  }

  const { data, error } = await authClient.changePassword({
    currentPassword: currentPassword.trim(),
    newPassword: newPassword.trim(),
  });

  if (error) {
    return { ok: false, error: betterAuthErrorToBaseError(error) };
  }

  return { ok: true, data };
}