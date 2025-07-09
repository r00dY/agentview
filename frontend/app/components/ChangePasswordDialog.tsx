import React, { useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Input } from "~/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { AlertCircleIcon } from "lucide-react";
import { useFetcher } from "react-router";
import type { FormActionData } from "~/lib/FormActionData";
import { useFetcherSuccess } from "~/lib/useFetcherSuccess";

interface ChangePasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChangePasswordDialog({
  open,
  onOpenChange,
}: ChangePasswordDialogProps) {
  const changePasswordFetcher = useFetcher();
  const actionData = changePasswordFetcher.data as FormActionData | undefined;

  useFetcherSuccess(changePasswordFetcher, () => {
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change Password</DialogTitle>
          <DialogDescription>Update your password here.</DialogDescription>
        </DialogHeader>

        <changePasswordFetcher.Form
          action="/change-password"
          method="post"
          className="space-y-4"
        >
          {/* General error alert */}
          {actionData?.status === "error" && actionData.error && changePasswordFetcher.state === 'idle' && (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Password change failed.</AlertTitle>
              <AlertDescription>{actionData.error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="current-password">Current Password</Label>
            <Input
              id="current-password"
              type="password"
              name="currentPassword"
              autoFocus
            />
            {actionData?.status === "error" && actionData?.fieldErrors?.currentPassword && changePasswordFetcher.state === 'idle' && (
              <p id="current-password-error" className="text-sm text-destructive">
                {actionData.fieldErrors.currentPassword}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-password">New Password</Label>
            <Input
              id="new-password"
              type="password"
              name="newPassword"
            />
            {actionData?.status === "error" && actionData?.fieldErrors?.newPassword && changePasswordFetcher.state === 'idle' && (
              <p id="new-password-error" className="text-sm text-destructive">
                {actionData.fieldErrors.newPassword}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm New Password</Label>
            <Input
              id="confirm-password"
              type="password"
              name="confirmPassword"
            />
            {actionData?.status === "error" && actionData?.fieldErrors?.confirmPassword && changePasswordFetcher.state === 'idle' && (
              <p id="confirm-password-error" className="text-sm text-destructive">
                {actionData.fieldErrors.confirmPassword}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={changePasswordFetcher.state !== 'idle'}>Change Password</Button>
          </DialogFooter>
        </changePasswordFetcher.Form>
      </DialogContent>
    </Dialog>
  );
} 