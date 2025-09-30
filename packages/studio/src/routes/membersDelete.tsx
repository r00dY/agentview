import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import type { ActionFunctionArgs, LoaderFunctionArgs, RouteObject } from "react-router";
import { data, redirect, useFetcher, useLoaderData, useNavigate } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { AlertCircleIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { apiFetch } from "~/lib/apiFetch";
import type { ActionResponse } from "~/lib/errors";

async function loader({ params }: LoaderFunctionArgs) {
  const response = await apiFetch(`/api/users`);

  if (!response.ok) {
    throw new Error('Failed to fetch members');
  }

  const user = response.data.find((user: any) => user.id === params.userId);

  if (!user) {
    throw data({ message: "User not found" }, { status: 404 });
  }

  return { user }
}

async function action({ request }: ActionFunctionArgs): Promise<Response | ActionResponse> {
  const formData = await request.formData();
  const userId = formData.get("userId") as string;

  const response = await apiFetch(`/api/members/${userId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    return {
      ok: false,
      error: response.error,
    }
  }

  return redirect("/members");
}

function Component() {
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
            {fetcher.data?.ok === false && fetcher.data.error && fetcher.state === 'idle' && (
              <Alert variant="destructive" className="mb-4">
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

export const membersDeleteRoute: RouteObject = {
  Component,
  loader,
  action,
}
