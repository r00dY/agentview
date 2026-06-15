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
import { Button } from "@agentview/studio/components/ui/button";
import { queryClient } from "~/queryClient";
import { queryKeys } from "~/queryKeys";
import { betterAuthErrorToBaseError, type ActionResponse } from "@agentview/studio/lib/errors";
import { useFetcherSuccess } from "@agentview/studio/hooks/useFetcherSuccess";
import { toast } from "sonner";
import { createApiKeyPair } from "~/apiKeyPairs";

type CreatedPair = { secretKey: string; publicKey: string };

export async function clientAction({
  request,
  params,
}: Route.ActionArgs): Promise<ActionResponse<CreatedPair>> {
  const formData = await request.formData();
  const name = formData.get("name") as string;

  const { data, error } = await createApiKeyPair(params.orgId!, name);

  if (error || !data) {
    return { ok: false, error: betterAuthErrorToBaseError(error!) };
  }

  await queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys() });

  return { ok: true, data: { secretKey: data.secret.key, publicKey: data.publicKey.key } };
}

function KeyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <Input value={value} readOnly className="font-mono" />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => {
            navigator.clipboard.writeText(value);
            toast.success(`${label} copied to clipboard`);
          }}
        >
          <CopyIcon className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export default function ApiKeysNew() {
  const fetcher = useFetcher<ActionResponse<CreatedPair>>();
  const navigate = useNavigate();
  const { orgId } = useParams();
  const [createdPair, setCreatedPair] = useState<CreatedPair | null>(null);

  useFetcherSuccess(fetcher, (data) => {
    if (data?.secretKey && data?.publicKey) {
      setCreatedPair({ secretKey: data.secretKey, publicKey: data.publicKey });
    }
  });

  const handleClose = () => {
    navigate(`/orgs/${orgId}/api-keys`);
  };

  // Show the key pair display dialog after creation
  if (createdPair) {
    return (
      <Dialog open={true} onOpenChange={handleClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API Key Pair Created</DialogTitle>
            <DialogDescription>
              Please save your secret key in a safe place since you won't be able to view it again.
              Keep it secure, as anyone with your secret key can make requests on your behalf.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <KeyField label="Public Key" value={createdPair.publicKey} />
            <KeyField label="Secret Key" value={createdPair.secretKey} />
          </DialogBody>

          <DialogFooter>
            <Button onClick={handleClose}>I've copied the keys</Button>
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
            <DialogTitle>Create API Key Pair</DialogTitle>
            <DialogDescription>
              This creates a matching secret (sk_) and public (pk_) key. They are managed together.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            {fetcher.data?.ok === false && (
              <Alert variant="destructive">
                <AlertCircleIcon className="h-4 w-4" />
                <AlertTitle>Failed to create API key pair</AlertTitle>
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
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={fetcher.state !== "idle"}>
              {fetcher.state === "submitting" ? "Creating..." : "Create API Key Pair"}
            </Button>
          </DialogFooter>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
