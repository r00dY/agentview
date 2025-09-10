import { redirect, Form, useActionData, useFetcher, data } from "react-router";
import type { Route } from "./+types/threadNew";
import { Header, HeaderTitle } from "~/components/header";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { apiFetch } from "~/lib/apiFetch";
import { getThreadsList } from "~/lib/utils";
import { type ActionResponse } from "~/lib/errors";
import { config } from "../../agentview.config";
import { AlertCircleIcon } from "lucide-react";
import { useRef } from "react";
import { FormField } from "~/components/form";

const threadConfig = config.threads[0];

export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  if (!threadConfig) {
    throw new Error("No threads available in the config object.");
  }

  const list = getThreadsList(request);

  if (threadConfig.metadata && (threadConfig.metadata?.length > 0)) {
    return {}
  }

  /** NO METADATA CASE **/

  const clientResponse = await apiFetch('/api/clients', {
    method: 'POST',
    body: {}
  });

  if (!clientResponse.ok) {
    throw data(clientResponse.error, { status: clientResponse.status });
  }

  const client_id = clientResponse.data.id;

  const threadResponse = await apiFetch('/api/threads', {
    method: 'POST',
    body: {
      type: threadConfig.type,
      client_id: client_id
    }
  });

  if (!threadResponse.ok) {
    throw data(threadResponse.error, { status: threadResponse.status });
  }

  return redirect(`/threads/${threadResponse.data.id}?list=${list}`);

}


export async function clientAction({ request, params }: Route.ClientActionArgs): Promise<ActionResponse | Response> {
  const list = getThreadsList(request);
  const formData = await request.formData();

  if (!threadConfig) {
    return { ok: false, error: { message: "No threads available in the config object." } };
  }

  // Validate and collect metadata fields
  const metadata: Record<string, any> = {};
  const fieldErrors: Record<string, string> = {};

  if (threadConfig.metadata && threadConfig.metadata.length > 0) {
    for (const metafield of threadConfig.metadata) {
      const fieldValue = formData.get(metafield.name);
      
      try {
        // Parse JSON value if it exists
        const parsedValue = fieldValue ? JSON.parse(fieldValue as string) : undefined;
        
        // Validate using the schema
        const validationResult = metafield.schema.safeParse(parsedValue);
        
        if (!validationResult.success) {
          fieldErrors[metafield.name] = validationResult.error.errors[0]?.message || `Invalid ${metafield.name}`;
        } else {
          metadata[metafield.name] = validationResult.data;
        }
      } catch (error) {
        fieldErrors[metafield.name] = `Invalid format for ${metafield.name}`;
      }
    }

    // Return validation errors if any
    if (Object.keys(fieldErrors).length > 0) {
      return { ok: false, error: { message: "Validation failed", fieldErrors } };
    }
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

  // Then create the thread with the new client_id and all metadata
  const threadResponse = await apiFetch('/api/threads', {
    method: 'POST',
    body: {
      type: threadConfig.type,
      client_id: client_id,
      metadata: metadata
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

  return <div className="flex-1">
    <Header>
      <HeaderTitle title={`New Thread`} />
    </Header>

    <div className="flex-1 overflow-y-auto">
      <div className="p-6 max-w-4xl space-y-6">
        <Content />
      </div>
    </div>
  </div>
}

function Content() {
  const fetcher = useFetcher();
  const formRef = useRef<HTMLFormElement>(null);

  return <div>
    {fetcher.state === 'idle' && fetcher.data?.ok === false && (
      <Alert variant="destructive" className="mb-4">
        <AlertCircleIcon className="h-4 w-4" />
        <AlertDescription>{fetcher.data.error.message}</AlertDescription>
      </Alert>
    )}


    <Form method="post" ref={formRef} className="max-w-xl">

      {threadConfig.metadata?.length > 0 && (<div>

        {/* <h3 className="text-sm font-medium mb-4 text-gray-700">Thread properties</h3> */}

        <div className="space-y-2">
          {threadConfig.metadata?.map((metafield: any) => (<FormField
            key={metafield.name}
            id={metafield.name}
            label={metafield.title ?? metafield.name}
            error={fetcher.data?.error?.fieldErrors?.[metafield.name]}
            name={metafield.name}
            defaultValue={undefined}
            // defaultValue={scores[metafield.name] ?? undefined}
            InputComponent={metafield.input}
            options={metafield.options}
          />
          ))}
        </div>

      </div>)}

      <div className={`gap-2 justify-start mt-4 flex`}>
        <Button
          type="submit"
          size="sm"
          disabled={fetcher.state !== 'idle'}
        >
          {fetcher.state !== 'idle' ? 'Posting...' : 'Submit'}

        </Button>
        <Button
          type="reset"
          variant="ghost"
          size="sm"
          onClick={(e) => {
            formRef.current?.reset();
          }}
        >
          Cancel
        </Button>
      </div>
    </Form>
  </div>
}