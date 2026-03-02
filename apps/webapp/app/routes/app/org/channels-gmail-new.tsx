import { useNavigate, useParams } from "react-router";
import type { Route } from "./+types/channels-gmail-new";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from "@agentview/studio/components/ui/dialog";
import { Button } from "@agentview/studio/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@agentview/studio/components/ui/alert";
import { AlertCircleIcon, MailIcon, Loader2Icon } from "lucide-react";
import { apiRequest } from "~/apiClient";
import { useState } from "react";

export default function ChannelsGmailNew() {
  const navigate = useNavigate();
  const { orgId } = useParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<{ url: string }>(orgId!, 'GET', '/api/channels/gmail/auth');
      window.location.href = data.url;
    } catch (err: any) {
      setError(err.message ?? 'Failed to start Gmail connection');
      setLoading(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={() => navigate(`/orgs/${orgId}/channels`)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect Gmail</DialogTitle>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircleIcon className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <p className="text-sm text-muted-foreground">
            Connect a Gmail account to receive and send emails through AgentView.
            You'll be redirected to Google to authorize access.
          </p>
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => navigate(`/orgs/${orgId}/channels`)}>
            Cancel
          </Button>
          <Button onClick={handleConnect} disabled={loading}>
            {loading ? (
              <>
                <Loader2Icon className="w-4 h-4 mr-2 animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                <MailIcon className="w-4 h-4 mr-2" />
                Connect Gmail
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
