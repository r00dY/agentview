import { redirect, Form, useActionData, useFetcher, data, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, RouteObject } from "react-router";
import { Header, HeaderTitle } from "../components/header";
import { agentview, AgentViewError } from "../lib/agentview";
import { getListParams, toQueryParams } from "../lib/listParams";
import { type ActionResponse } from "../lib/errors";
import { config } from "../config";
import { requireAgentConfig, requireChannelConfig } from "agentview/configUtils";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { AlertCircleIcon } from "lucide-react";
import { getSessionCached } from "../lib/auth-client";

function getAgentNameFromRequest(request: Request): string {
  const url = new URL(request.url);
  const agentName = url.searchParams.get('agent');
  if (!agentName) {
    throw new Error('Agent name is required');
  }

  return agentName

  // const channelConfig = config.channels?.find(
  //   (c): c is ApiChannelConfig => c.type === 'api' && c.name === channelName
  // );
  // if (!channelConfig) {
  //   throw new Error(`Channel '${channelName}' not found`);
  // }

  // return channelConfig;
}

async function loader({ request }: LoaderFunctionArgs) {
  const channelConfig = requireChannelConfig(config, { type: 'api', name: getAgentNameFromRequest(request) });

  return {
    channelConfig
  }
}

async function action({ request, params }: ActionFunctionArgs): Promise<ActionResponse | Response> {
  const authSession = (await getSessionCached())!;
  const agentName = getAgentNameFromRequest(request);

  const channelConfig = requireChannelConfig(config, { type: 'api', name: agentName });
  // const agentConfig = requireAgentConfig(config, channelConfig.agent);
  const listParams = getListParams(request);

  // This action only supports JSON payloads, other encoding methods (like form data) treat this request as if context was not provided
  let payload: any = undefined;
  if (request.headers.get("Content-Type") === "application/json") {
    payload = await request.json();
  }

  if (!payload && channelConfig.newSessionComponent) {
    return redirect(`/sessions/new?agent=${agentName}&${toQueryParams(listParams)}`, { status: 303 });
  }

  try {
    const user = await agentview.createUser();
    const session = await agentview.createSession({
      agent: agentName,
      userId: user.id,
      metadata: payload?.metadata
    });

    return redirect(`/sessions/${session.id}?${toQueryParams(listParams)}`);
  } catch (error) {
    if (error instanceof AgentViewError) {
      return { ok: false, error: { message: error.message, statusCode: error.statusCode, ...error.details } };
    }
    throw error;
  }
}

function Component() {
  const { channelConfig } = useLoaderData<typeof loader>();

  const actionData = useActionData<typeof action>();
  const fetcher = useFetcher();
  const data = actionData ?? fetcher.data;
  const error = data?.ok === false ? data.error : undefined;

  return <div className="flex-1">
    <Header>
      <HeaderTitle title={`New Session`} />
    </Header>

    <div className="flex-1 overflow-y-auto">
      <div className="p-6 max-w-4xl space-y-6">

        {error && error.code === 'parse.schema' && <Alert variant="destructive">
          <AlertCircleIcon className="h-4 w-4" />
          <AlertTitle>One or more required metadata fields are missing.</AlertTitle>
          <AlertDescription>
            <pre className="text-xs my-2">{JSON.stringify(error.issues, null, 2)}</pre>
            Either provide default values for required metadata fields or use a New Session Form so that user can provide the missing metadata before creating a session.
          </AlertDescription>
        </Alert>}

        {error && error?.code !== 'parse.schema' && <Alert variant="destructive">
          <AlertCircleIcon className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>}

        {channelConfig.newSessionComponent && <channelConfig.newSessionComponent
          submit={(values) => { 
            fetcher.submit(values ?? {}, { method: 'post', encType: 'application/json' }) 
          }}
          isRunning={fetcher.state === "submitting"}
        />}

        {!channelConfig.newSessionComponent && !error && <Alert variant="default">
          <AlertCircleIcon className="h-4 w-4" />
          <AlertTitle>No New Session Form</AlertTitle>
          <AlertDescription>
            This agent does not have a New Session Form.
          </AlertDescription>
        </Alert>}

      </div>
    </div>
  </div>
}

export const sessionNewRoute: RouteObject = {
  Component,
  loader,
  action,
}