import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import type { Route } from "./+types/membersEdit";
import { redirect, useFetcher, useLoaderData, useNavigate } from "react-router";
import { auth } from "~/.server/auth";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { AlertCircleIcon } from "lucide-react";
import { Label } from "~/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Button } from "~/components/ui/button";
import { APIError } from "better-auth/api";


export async function loader({ params, request }: Route.LoaderArgs) {
  const users = await auth.api.listUsers({
    headers: request.headers,
    query: {
      limit: 100,
    },
  });

  const user = users.users.find((user) => user.id === params.userId);

  if (!user) {
    throw new Error("User not found");
  }

  return { user }
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const userId = formData.get("userId") as string;
  const role = formData.get("role") as "admin" | "user";

    try {
      await auth.api.setRole({
        headers: request.headers,
        body: { userId, role },
      });

      return redirect("/members");
      
    } catch (error) {
      if (error instanceof APIError) {
        return {
          status: "error",
          error: error.message,
        }
      }
      return {
        status: "error",
        error: "Unexpected error",
      }
    }
}

export default function MembersEdit() {
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const { user } = useLoaderData<typeof loader>();
  
  return <div className="bg-red-500">
    <Dialog open={true} onOpenChange={() => { navigate(-1) }}>
    <DialogContent>
    <fetcher.Form method="post" className="space-y-4">


        <DialogHeader>
          <DialogTitle>Edit Member</DialogTitle>
        </DialogHeader>
        
        <DialogBody className="space-y-5">

            <input type="hidden" name="_action" value="updateRole" />
            <input type="hidden" name="userId" value={user.id} />
            
            {/* General error alert */}
            {fetcher.data?.status === "error" && fetcher.data.error && fetcher.state === 'idle' && (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertTitle>Role update failed.</AlertTitle>
                <AlertDescription>{fetcher.data.error}</AlertDescription>
              </Alert>
            )}
            
            <div className="space-y-2">
              <Label>Email</Label>
              <div className="text-sm text-muted-foreground">{user.email}</div>
              <input type="hidden" name="email" value={user.email} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
                <Select defaultValue={user.role} name="role">
                <SelectTrigger>
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={"admin"}>Admin</SelectItem>
                  <SelectItem value={"user"}>User</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </DialogBody>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => navigate(-1)}>
                Cancel
              </Button>
              <Button type="submit" disabled={fetcher.state !== "idle"}>Save</Button>
            </DialogFooter>
            </fetcher.Form>
      </DialogContent>
    </Dialog>
  </div>
}
