import { redirect, Form, useActionData } from "react-router";
import type { Route } from "./+types/threadNew";
import { Header, HeaderTitle } from "~/components/header";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { authClient } from "~/lib/auth-client";
import { apiFetch } from "~/lib/apiFetch";
import { getThreadsList } from "~/lib/utils";
import { type ActionResponse } from "~/lib/errors";

export async function clientAction({ request, params }: Route.ClientActionArgs): Promise<ActionResponse | Response> {
  const list = getThreadsList(request);
  const formData = await request.formData();
  const product_id = formData.get("product_id");

  if (!product_id || typeof product_id !== 'string') {
    return { ok: false, error: { message: "Product ID is required" } };
  }

  // Create a client first
  const clientResponse = await apiFetch('/api/clients', {
    method: 'POST',
    body: {}
  });

  if (!clientResponse.ok) {
    return { ok: false, error: clientResponse.error };
  }

  const client_id = clientResponse.data.id;

  // Then create the thread with the new client_id
  const threadResponse = await apiFetch('/api/threads', {
    method: 'POST',
    body: {
      type: "pdp_chat",
      client_id: client_id,
      metadata: {
        product_id: product_id
      }
    }
  });

  if (!threadResponse.ok) {
    return { ok: false, error: threadResponse.error };
  }

  // Redirect to the new thread
  return redirect(`/threads/${threadResponse.data.id}?list=${list}`);

}

export default function ThreadNew() {
  const actionData = useActionData<typeof clientAction>();
    
  return <>
    <Header>
      <HeaderTitle title={`New Thread`} />
    </Header>

    <div className="flex-1 overflow-y-auto">
      <div className="p-6 max-w-4xl space-y-6">

          <Form method="post" className="space-y-4">
            {actionData && !actionData.ok && (
              <Alert variant="destructive">
                <AlertDescription>{actionData.error.message}</AlertDescription>
              </Alert>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="product_id">Product ID</Label>
              <Input
                id="product_id"
                name="product_id"
                type="text"
                placeholder="Enter product ID"
                required
              />
            </div>
            
            <Button type="submit" className="w-full">
              Create Thread
            </Button>
          </Form>
      </div>
    </div>
  </>
}
