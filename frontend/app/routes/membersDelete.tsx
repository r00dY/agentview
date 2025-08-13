import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import type { Route } from "./+types/membersDelete";
import { redirect, useFetcher, useLoaderData, useNavigate } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { AlertCircleIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { getAPIBaseUrl } from "~/lib/getAPIBaseUrl";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const response = await fetch(`${getAPIBaseUrl()}/api/members`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch members');
  }

  const users = await response.json();
  const user = users.find((user: any) => user.id === params.userId);

  if (!user) {
    throw new Error("User not found");
  }

  return { user }
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData();
  const userId = formData.get("userId") as string;

  try {
    const response = await fetch(`${getAPIBaseUrl()}/api/members/${userId}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json();
      return {
        status: "error",
        error
      }
    }

    return redirect("/members");
    
  } catch (error: any) {
    return {
      status: "error",
      error: error.message || "Unexpected error",
    }
  }
}

export default function MembersDelete() {
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const { user } = useLoaderData<typeof clientLoader>();
  
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
                <AlertDescription>{fetcher.data.error.message}</AlertDescription>
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
