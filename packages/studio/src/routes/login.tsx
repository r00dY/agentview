import { redirect, useLoaderData, type LoaderFunctionArgs, type RouteObject } from "react-router";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { CardPageLayout } from "../components/CardPageLayout";
import { authClient } from "../lib/auth-client";
import { getWebAppUrl, getApiUrl } from "agentview/urls";
import { config } from "../config";
import { agentview, publicClient } from "../lib/agentview";
import { stripBasename } from "../lib/basename";


function getRedirectUrl(stringUrl: string) {
  const url = new URL(stringUrl);

  // Otherwise use the redirect param or default to /
  const redirectTo = url.searchParams.get('redirect');
  if (redirectTo && redirectTo.startsWith('/')) {
    // The path passed to react-router's redirect() is relative to the router's
    // basename — strip the basename if it's already in the redirect param,
    // otherwise the router would prepend it again.
    return stripBasename(redirectTo);
  }
  return '/';
}

async function loader({ request }: LoaderFunctionArgs) {
  const sessionResponse = await authClient.getSession()

  // if logged in just redirect
  if (sessionResponse.data) {
    return redirect(getRedirectUrl(request.url));
  }

  const organization = await publicClient.organization.get();

  // Check for token in query params
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (token) {
    window.localStorage.setItem('agentview_token', token);
    window.localStorage.setItem('agentview_organization_id', organization.id);
    url.searchParams.delete('token');
    return redirect(getRedirectUrl(url.toString()));
  }

  return {
    organization,
  }
}

function Component() {
  const loaderData = useLoaderData<typeof loader>();
  const authUrl = new URL(getWebAppUrl() + "/auth");
  authUrl.searchParams.set("origin", window.location.href);

  return (
    <CardPageLayout variant="poweredBy">
      <Card>
        <CardHeader>
          <CardTitle className="text-center">Sign in to <span className="">{loaderData?.organization.name}</span></CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button asChild variant="outline" className="w-full">
            <a href={authUrl.toString()}>Email / password</a>
          </Button>
        </CardContent>
      </Card>
    </CardPageLayout>
  );
}

export const loginRoute : RouteObject = {
  Component,
  loader,
}
