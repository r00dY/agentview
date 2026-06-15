import { data, redirect, useFetcher, useLoaderData, useNavigate, useParams } from "react-router";
import type { Route } from "./+types/api-keys-delete";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agentview/studio/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@agentview/studio/components/ui/alert";
import { AlertCircleIcon } from "lucide-react";
import { Button } from "@agentview/studio/components/ui/button";
import { queryClient } from "~/queryClient";
import { queryKeys } from "~/queryKeys";
import { betterAuthErrorToBaseError, type ActionResponse } from "@agentview/studio/lib/errors";
import { deleteApiKeyPair, listApiKeyPairs } from "~/apiKeyPairs";

export async function clientLoader({ params }: Route.LoaderArgs) {
  const { data: pairs, error } = await listApiKeyPairs(params.orgId);

  if (error) {
    throw data(betterAuthErrorToBaseError(error));
  }

  const pair = (pairs ?? []).find((p) => p.pairId === params.pairId);

  if (!pair) {
    throw data({ message: "API key pair not found" });
  }

  return { pair };
}

export async function clientAction({ params }: Route.ActionArgs): Promise<ActionResponse | Response> {
  const { error } = await deleteApiKeyPair(params.orgId!, params.pairId!);

  if (error) {
    return { ok: false, error: betterAuthErrorToBaseError(error) };
  }

  await queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys() });

  return redirect(`/orgs/${params.orgId}/api-keys`);
}

export default function ApiKeysDelete() {
  const fetcher = useFetcher<ActionResponse>();
  const navigate = useNavigate();
  const { orgId } = useParams();
  const { pair } = useLoaderData<typeof clientLoader>();

  const handleClose = () => {
    navigate(`/orgs/${orgId}/api-keys`);
  };

  return (
    <Dialog open={true} onOpenChange={handleClose}>
      <DialogContent>
        <fetcher.Form method="post">
          <DialogHeader>
            <DialogTitle>Delete API Key Pair</DialogTitle>
          </DialogHeader>

          <DialogBody>
            {fetcher.data?.ok === false && fetcher.state === "idle" && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircleIcon className="h-4 w-4" />
                <AlertTitle>Failed to delete API key pair</AlertTitle>
                <AlertDescription>{fetcher.data.error.message}</AlertDescription>
              </Alert>
            )}

            <p className="text-sm">
              Are you sure you want to delete the API key pair{" "}
              <strong className="font-medium">{pair.name || "Unnamed"}</strong>?
              Both the public and secret keys will be deleted. This action cannot be undone and any
              applications using these keys will stop working.
            </p>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={fetcher.state !== "idle"}
            >
              {fetcher.state === "submitting" ? "Deleting..." : "Delete API Key Pair"}
            </Button>
          </DialogFooter>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
