import { useFetcher, useLoaderData, useNavigate, useParams } from "react-router";
import type { Route } from "./+types/channels-edit";
import type { Channel, EnvironmentBase } from "agentview/apiTypes";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogBody } from "@agentview/studio/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@agentview/studio/components/ui/alert";
import { AlertCircleIcon } from "lucide-react";
import { Label } from "@agentview/studio/components/ui/label";
import { Input } from "@agentview/studio/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@agentview/studio/components/ui/select";
import { Button } from "@agentview/studio/components/ui/button";
import { queryClient } from "~/queryClient";
import { queryKeys } from "~/queryKeys";
import type { ActionResponse } from "@agentview/studio/lib/errors";
import { apiRequest } from "~/apiClient";

export async function clientLoader({ params }: Route.LoaderArgs) {
  const [channels, environments] = await Promise.all([
    queryClient.fetchQuery({
      queryKey: queryKeys.channels(params.orgId),
      queryFn: () => apiRequest<Channel[]>(params.orgId, 'GET', '/api/channels'),
    }),
    queryClient.fetchQuery({
      queryKey: queryKeys.environments(params.orgId),
      queryFn: () => apiRequest<EnvironmentBase[]>(params.orgId, 'GET', '/api/environments'),
    }),
  ]);

  const channel = channels.find((c) => c.id === params.channelId);

  return { channel, environments };
}

export async function clientAction({ request, params }: Route.ActionArgs): Promise<ActionResponse | Response> {
  const formData = await request.formData();
  const agent = formData.get("agent") as string;
  const environmentId = formData.get("environmentId") as string;

  const { channelId, orgId } = params;

  const body: Record<string, any> = {
    agent: agent || null,
    environmentId: environmentId && environmentId !== "__none__" ? environmentId : null,
  };

  try {
    await apiRequest(orgId, 'PATCH', `/api/channels/${channelId}`, body);
  } catch (err: any) {
    return { ok: false, error: { message: err.message ?? 'Failed to update channel' } };
  }

  await queryClient.invalidateQueries({ queryKey: queryKeys.channels(orgId) });

  return new Response(null, {
    status: 302,
    headers: { Location: `/orgs/${orgId}/channels` },
  });
}

export default function ChannelsEdit() {
  const fetcher = useFetcher<ActionResponse>();
  const navigate = useNavigate();
  const { orgId } = useParams();
  const { channel, environments } = useLoaderData<typeof clientLoader>();

  console.log(environments);

  if (!channel) {
    return (
      <Dialog open={true} onOpenChange={() => navigate(`/orgs/${orgId}/channels`)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Channel not found</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-muted-foreground">This channel does not exist.</p>
          </DialogBody>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={true} onOpenChange={() => navigate(`/orgs/${orgId}/channels`)}>
      <DialogContent>
        <fetcher.Form method="post" className="space-y-4">
          <DialogHeader>
            <DialogTitle>Edit Channel</DialogTitle>
          </DialogHeader>

          <DialogBody className="space-y-4">
            {fetcher.data?.ok === false && fetcher.state === 'idle' && (
              <Alert variant="destructive">
                <AlertCircleIcon className="h-4 w-4" />
                <AlertTitle>Update failed</AlertTitle>
                <AlertDescription>{fetcher.data.error.message}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label>Address</Label>
              <div className="text-sm text-muted-foreground">{channel.address}</div>
            </div>

            <div className="space-y-2">
              <Label>Type</Label>
              <div className="text-sm text-muted-foreground">{channel.type}</div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="environmentId">Environment</Label>
              <Select defaultValue={channel.environment?.id ?? "__none__"} name="environmentId">
                <SelectTrigger>
                  <SelectValue placeholder="Select an environment" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {environments.map((env) => (
                    <SelectItem key={env.id} value={env.id}>
                      {env.user ? `dev:${env.user.email}` : 'prod'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="agent">Agent</Label>
              <Input
                name="agent"
                defaultValue={channel.agent ?? ""}
                placeholder="e.g. support-agent"
              />
            </div>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => navigate(`/orgs/${orgId}/channels`)}>
              Cancel
            </Button>
            <Button type="submit" disabled={fetcher.state !== "idle"}>
              {fetcher.state === "submitting" ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
