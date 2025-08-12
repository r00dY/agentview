import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import type { Route } from "./+types/home";
import { redirect, useFetcher, useNavigate } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { AlertCircleIcon } from "lucide-react";
import { Label } from "~/components/ui/label";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Button } from "~/components/ui/button";
import { getAPIBaseUrl } from "~/lib/getAPIBaseUrl";
import { data } from "react-router";

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData();
  const email = formData.get("email") as string;
  const role = formData.get("role") as string;

  const response = await fetch(`${getAPIBaseUrl()}/api/invitations`, {
    method: "POST",
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, role }),
  });

  const data = await response.json();

  if (!response.ok) {
    return {
      status: "error",
      error: data
    }
  }

  return redirect('/members');
}


export default function InvitationNew() {
  const fetcher = useFetcher();
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
          {fetcher.data?.status === "error" && (
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
