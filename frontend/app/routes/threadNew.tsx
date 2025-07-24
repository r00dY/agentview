import { redirect, useLoaderData, useFetcher, Outlet, Link, Form, useActionData } from "react-router";
import type { Route } from "./+types/threadNew";
import { Header, HeaderTitle } from "~/components/header";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Alert, AlertDescription } from "~/components/ui/alert";

export async function action({ request, params }: Route.ActionArgs) {
    const formData = await request.formData();
    const product_id = formData.get("product_id");

    if (!product_id || typeof product_id !== 'string') {
        return { error: "Product ID is required" };
    }

    try {
        // First, create a client
        const clientResponse = await fetch(`http://localhost:2138/clients`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
        });

        const clientData = await clientResponse.json();

        if (!clientResponse.ok) {
            return { error: clientData };
        }

        const client_id = clientData.id;

        // Then create the thread with the new client_id
        const threadResponse = await fetch(`http://localhost:2138/threads`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                type: "pdp_chat",
                client_id: client_id,
                metadata: {
                    product_id: product_id
                }
            }),
        });

        const threadData = await threadResponse.json();

        if (!threadResponse.ok) {
            return { error: threadData || "Failed to create thread" };
        }

        // Redirect to the new thread
        return redirect(`/threads/${threadData.id}`);

    } catch (error) {
        console.error(error);
        return { error: "Failed to create thread" };
    }
}

export default function ThreadNew() {
  const actionData = useActionData<typeof action>();
    
  return <>
    <Header>
      <HeaderTitle title={`New Thread`} />
    </Header>

    <div className="flex-1 overflow-y-auto">
      <div className="p-6 max-w-4xl space-y-6">

          <Form method="post" className="space-y-4">
            {actionData?.error && (
              <Alert variant="destructive">
                <AlertDescription>{actionData.error}</AlertDescription>
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
