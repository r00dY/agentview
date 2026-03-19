import { useState } from "react";
import { useFetcher, useNavigate, useParams } from "react-router";
import type { Route } from "./+types/api-keys-new";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agentview/studio/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@agentview/studio/components/ui/alert";
import { AlertCircleIcon, CopyIcon } from "lucide-react";
import { Label } from "@agentview/studio/components/ui/label";
import { Input } from "@agentview/studio/components/ui/input";
import { Switch } from "@agentview/studio/components/ui/switch";
import { Button } from "@agentview/studio/components/ui/button";
import { authClient } from "~/authClient";
import { queryClient } from "~/queryClient";
import { queryKeys } from "~/queryKeys";
import { betterAuthErrorToBaseError, type ActionResponse } from "@agentview/studio/lib/errors";
import { useFetcherSuccess } from "@agentview/studio/hooks/useFetcherSuccess";
import { toast } from "sonner";

export async function clientAction({
  request,
  params,
}: Route.ActionArgs): Promise<ActionResponse<{ apiKey: any }>> {
  const formData = await request.formData();
  const name = formData.get("name") as string;
  const isSecret = formData.get("isSecret") === "true";

  const response = await authClient.apiKey.create({
    name,
    prefix: isSecret ? 'sk_' : 'pk_',
    metadata: {
      organizationId: params.orgId
    },
  });

  if (response.error) {
    return { ok: false, error: betterAuthErrorToBaseError(response.error) };
  }

  await queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys() });

  return { ok: true, data: { apiKey: response.data } };
}

export default function ApiKeysNew() {
  const fetcher = useFetcher<ActionResponse<{ apiKey: any }>>();
  const navigate = useNavigate();
  const { orgId } = useParams();
  const [isSecret, setIsSecret] = useState(true);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);

  useFetcherSuccess(fetcher, (data) => {
    if (data?.apiKey?.key) {
      setNewApiKey(data.apiKey.key);
    }
  });

  const handleClose = () => {
    navigate(`/orgs/${orgId}/api-keys`);
  };

  // Show the key display dialog after creation
  if (newApiKey) {
    return (
      <Dialog open={true} onOpenChange={handleClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API Key Created</DialogTitle>
            <DialogDescription>
              Please save your secret key in a safe place since you won't be able to view it again.
              Keep it secure, as anyone with your API key can make requests on your behalf.
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            <div className="space-y-2">
              <Label>Your API Key</Label>
              <div className="flex items-center gap-2">
                <Input value={newApiKey} readOnly className="font-mono" />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    navigator.clipboard.writeText(newApiKey);
                    toast.success("API key copied to clipboard");
                  }}
                >
                  <CopyIcon className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </DialogBody>

          <DialogFooter>
            <Button onClick={handleClose}>I've copied the key</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={true} onOpenChange={handleClose}>
      <DialogContent>
        <fetcher.Form method="post" className="space-y-4">
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
          </DialogHeader>

          <DialogBody className="space-y-4">
            {fetcher.data?.ok === false && (
              <Alert variant="destructive">
                <AlertCircleIcon className="h-4 w-4" />
                <AlertTitle>Failed to create API key</AlertTitle>
                <AlertDescription>{fetcher.data.error.message}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="apiKeyName">Name</Label>
              <Input
                id="apiKeyName"
                name="name"
                type="text"
                placeholder="My API Key"
                autoComplete="off"
                required
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="apiKeyType">Secret Key</Label>
                <p className="text-sm text-muted-foreground">
                  Secret keys should only be used server-side
                </p>
              </div>
              <Switch
                id="apiKeyType"
                checked={isSecret}
                onCheckedChange={setIsSecret}
              />
              <input type="hidden" name="isSecret" value={isSecret.toString()} />
            </div>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={fetcher.state !== "idle"}>
              {fetcher.state === "submitting" ? "Creating..." : "Create API Key"}
            </Button>
          </DialogFooter>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
