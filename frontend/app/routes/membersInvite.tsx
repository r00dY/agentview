import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import type { Route } from "./+types/home";
import { useFetcher, useNavigate } from "react-router";
import { auth } from "../../lib/auth.server";
import { redirect } from "react-router";
import { createInvitation } from "../../lib/invitations";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { AlertCircleIcon } from "lucide-react";
import { Label } from "~/components/ui/label";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Button } from "~/components/ui/button";



export async function action({ request }: Route.ActionArgs) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return redirect("/login");

  const formData = await request.formData();
  const email = formData.get("email") as string;
  const role = formData.get("role") as string;

  try {
    await createInvitation(email, role, session.user.id)
    return redirect("/members");

  } catch (error) {
    if (error instanceof Error) {
      return {
        status: "error",
        error: error.message,
      }
    }
  }
}

export default function InvitationNew() {
  const fetcher = useFetcher();
  const navigate = useNavigate();
  
  return <div className="bg-red-500">
    <Dialog open={true} onOpenChange={() => { navigate(-1) }}>
    <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite Member</DialogTitle>
        </DialogHeader>
        <fetcher.Form method="post" className="space-y-4">
          <input type="hidden" name="_action" value="inviteMember" />
          
          {/* General error alert */}
          {fetcher.data?.status === "error" && fetcher.data.error && (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Invitation failed.</AlertTitle>
              <AlertDescription>{fetcher.data.error}</AlertDescription>
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
            {fetcher.data?.status === "error" && fetcher.data?.fieldErrors?.email && (
              <p id="email-error" className="text-sm text-destructive">
                {fetcher.data.fieldErrors.email}
              </p>
            )}
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
            {fetcher.data?.status === "error" && fetcher.data?.fieldErrors?.role && (
              <p id="role-error" className="text-sm text-destructive">
                {fetcher.data.fieldErrors.role}
              </p>
            )}
          </div>
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
