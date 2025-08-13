import React, { useEffect } from "react";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Input } from "~/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { AlertCircleIcon } from "lucide-react";
import { useFetcher } from "react-router";
import type { ActionResponse } from "~/lib/errors";
import { useFetcherSuccess } from "~/hooks/useFetcherSuccess";

interface EditProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: {
    email: string;
    name: string;
  };
  onSave?: (name: string) => void;
}

export function EditProfileDialog({
  open,
  onOpenChange,
  user,
}: EditProfileDialogProps) {
  const [name, setName] = React.useState(user.name);

  React.useEffect(() => {
    setName(user.name);
  }, [user.name, open]);

  const editFetcher = useFetcher<ActionResponse>();
  const actionData = editFetcher.data;

  useFetcherSuccess(editFetcher, () => {
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>


      <DialogContent>

<editFetcher.Form
          action="/user"
          method="put"
          className="space-y-4"
        >
        <DialogHeader>
          <DialogTitle>Edit Profile</DialogTitle>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {/* General error alert */}
          {editFetcher.state === 'idle' && actionData?.ok === false && (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Update failed.</AlertTitle>
              <AlertDescription>{actionData.error.message}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="edit-email">Email</Label>
            <Input
              id="edit-email"
              type="email"
              name="email"
              value={user.email}
              disabled={true}
              readOnly
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              name="name"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
            {editFetcher.state === 'idle' && actionData?.ok === false && actionData?.error.fieldErrors?.name && (
              <p id="name-error" className="text-sm text-destructive">
                {actionData.error.fieldErrors.name}
              </p>
            )}
          </div>

        </DialogBody>
        <DialogFooter>
            <Button
              variant="outline"
              type="button"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={editFetcher.state !== 'idle'}>Save Changes</Button>
          </DialogFooter>

        </editFetcher.Form>
        
      </DialogContent>
    </Dialog>
  );
}
