import { redirect, Form, useActionData, useFetcher, data, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, RouteObject } from "react-router";
import { Header, HeaderTitle } from "~/components/header";
import { Button } from "~/components/ui/button";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { apiFetch } from "~/lib/apiFetch";
import { getListParams, toQueryParams } from "~/lib/listParams";
import { type ActionResponse } from "~/lib/errors";
import { config } from "~/config";
import { AlertCircleIcon } from "lucide-react";
import { useRef } from "react";
import { FormField } from "~/components/form";
import { parseFormData } from "~/lib/parseFormData";
import { requireAgentConfig } from "~/lib/config";

async function loader({ request }: LoaderFunctionArgs) {
  const listParams = getListParams(request);
  const agentConfig = requireAgentConfig(config, listParams.agent);
 
  if (agentConfig.context) {
    return {
      agentConfig,
      listParams
    }
  }

  /** NO CONTEXT CASE **/

  const clientResponse = await apiFetch('/api/clients', {
    method: 'POST',
    body: {
      isShared: false
    }
  });

  if (!clientResponse.ok) {
    throw data(clientResponse.error, { status: clientResponse.status });
  }

  const sessionResponse = await apiFetch('/api/sessions', {
    method: 'POST',
    body: {
      agent: agentConfig.name,
      clientId: clientResponse.data.id
    }
  });

  if (!sessionResponse.ok) {
    throw data(sessionResponse.error, { status: sessionResponse.status });
  }

  return redirect(`/sessions/${sessionResponse.data.id}?${toQueryParams(listParams)}`);
}

async function action({ request, params }: ActionFunctionArgs): Promise<ActionResponse | Response> {
  const listParams = getListParams(request);
  const agentConfig = requireAgentConfig(config, listParams.agent);
  
  const formData = await request.formData();
  const parsedData = parseFormData(formData);

  const clientResponse = await apiFetch('/api/clients', {
    method: 'POST',
    body: {
      isShared: false
    }
  });

  if (!clientResponse.ok) {
    throw data(clientResponse.error, { status: clientResponse.status });
  }

  const sessionResponse = await apiFetch('/api/sessions', {
    method: 'POST',
    body: {
      agent: agentConfig.name,
      clientId: clientResponse.data.id,
      context: parsedData.context
    }
  });

  if (!sessionResponse.ok) {
    return { ok: false, error: sessionResponse.error };
  }

  return redirect(`/sessions/${sessionResponse.data.id}?${toQueryParams(listParams)}`);
}

function Component() {
  const actionData = useActionData<typeof action>();

  return <div className="flex-1">
    <Header>
      <HeaderTitle title={`New Session`} />
    </Header>

    <div className="flex-1 overflow-y-auto">
      <div className="p-6 max-w-4xl space-y-6">
        <Content />
      </div>
    </div>
  </div>
}

function Content() {
  const { agentConfig } = useLoaderData<typeof loader>();

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

      {agentConfig.context && (<div>

        Form

        {/* <div className="space-y-2">
          {agentConfig.metadata?.map((metafield: any) => (<FormField
            key={metafield.name}
            id={metafield.name}
            label={metafield.title ?? metafield.name}
            error={fetcher.data?.error?.fieldErrors?.[`metadata.${metafield.name}`]}
            name={'metadata.' + metafield.name}
            defaultValue={undefined}
            // defaultValue={scores[metafield.name] ?? undefined}
            InputComponent={metafield.input}
            options={metafield.options}
          />
          ))}
        </div> */}

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
          variant="secondary"
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

export const sessionNewRoute: RouteObject = {
  Component,
  loader,
  action,
}