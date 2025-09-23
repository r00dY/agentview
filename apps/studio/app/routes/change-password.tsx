import { authClient } from "~/lib/auth-client";
import { type ActionResponse, betterAuthErrorToBaseError } from "~/lib/errors";

export async function action({
  request,
}: { request: Request }): Promise<ActionResponse> {

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

export default function ChangePassword() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Change Password</h1>
      <p>Change password page content goes here.</p>
    </div>
  );
}