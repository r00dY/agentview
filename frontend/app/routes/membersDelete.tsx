import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import type { Route } from "./+types/membersDelete";
import { redirect, useFetcher, useLoaderData, useNavigate } from "react-router";
import { auth } from "../../lib/auth.server";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { AlertCircleIcon } from "lucide-react";
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
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return redirect("/login");

  const formData = await request.formData();
  const userId = formData.get("userId") as string;

  if (session.user.role !== "admin") {
    return {
      status: "error",
      error: "Not authorized.",
    }
  }

  try {
    await auth.api.removeUser({
      headers: request.headers,
      body: { userId },
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

export default function MembersDelete() {
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const { user } = useLoaderData<typeof loader>();
  
  return (
    <div>
      <Dialog open={true} onOpenChange={() => { navigate(-1) }}>
        <DialogContent>
        <fetcher.Form method="post">

          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
          </DialogHeader>

          <DialogBody>
            <input type="hidden" name="userId" value={user.id} />
            
            {/* General error alert */}
            {fetcher.data?.status === "error" && fetcher.data.error && fetcher.state === 'idle' && (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertTitle>User deletion failed.</AlertTitle>
                <AlertDescription>{fetcher.data.error}</AlertDescription>
              </Alert>
            )}
            
            <div className="space-y-2">
              <p className="text-sm">
                Are you sure you want to delete <strong className="font-medium">{user.email}</strong>? This action cannot be undone.
              </p>
            </div>
            </DialogBody>
            <DialogFooter className="border-0">
              <Button type="button" variant="outline" onClick={() => navigate(-1)}>
                Cancel
              </Button>
              <Button 
                type="submit" 
                variant="destructive" 
                disabled={fetcher.state !== "idle"}
              >
                Delete User
              </Button>
            </DialogFooter>
          </fetcher.Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
