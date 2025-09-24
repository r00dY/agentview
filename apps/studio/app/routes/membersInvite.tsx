import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import type { ActionFunctionArgs, RouteObject } from "react-router";
import { redirect, useFetcher, useNavigate } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { AlertCircleIcon } from "lucide-react";
import { Label } from "~/components/ui/label";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Button } from "~/components/ui/button";
import { apiFetch } from "~/lib/apiFetch";
import type { ActionResponse } from "~/lib/errors";

async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email = formData.get("email") as string;
  const role = formData.get("role") as string;

  const response = await apiFetch(`/api/invitations`, {
    method: "POST",
    body: { email, role },
  });

  if (!response.ok) {
    return {
      ok: false,
      error: response.error,
    }
  }

  return redirect('/members');
}


function Component() {
  const fetcher = useFetcher<ActionResponse>();
  const navigate = useNavigate();

  return <div className="bg-red-500">
    <Dialog open={true} onOpenChange={() => { navigate(-1) }}>
    <DialogContent>
    <fetcher.Form method="post" className="space-y-4">

        <DialogHeader>
          <DialogTitle>Invite Member</DialogTitle>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <input type="hidden" name="_action" value="inviteMember" />
          
          {/* General error alert */}
          {fetcher.data?.ok === false && (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Invitation failed.</AlertTitle>
              <AlertDescription>{fetcher.data.error.message}</AlertDescription>
            </Alert>
          )}
          
          <div className="space-y-2">
            <Label htmlFor="inviteMemberEmail">Email</Label>
            <Input
              id="inviteMemberEmail"
              name="email"
              type="email"
              placeholder="john@doe.com"
              autoComplete="off"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inviteMemberRole">Role</Label>
            <Select defaultValue={"user"} name="role">
              <SelectTrigger>
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={"user"}>User</SelectItem>
                <SelectItem value={"admin"}>Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button type="submit" disabled={fetcher.state !== "idle"}>
              Send Invitation
            </Button>
          </DialogFooter>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  </div>
}

export const membersInviteRoute: RouteObject = {
  Component,
  action,
}
