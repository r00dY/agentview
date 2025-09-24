import { redirect, Form, useActionData, data, type LoaderFunctionArgs, type ActionFunctionArgs, type RouteObject } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { AlertCircleIcon } from "lucide-react";
import { betterAuthErrorToBaseError, type ActionResponse } from "~/lib/errors";
import { authClient } from "~/lib/auth-client";
import { apiFetch } from "~/lib/apiFetch";

function redirectUrl(request: Request) {
  const url = new URL(request.url);
  const redirectTo = url.searchParams.get('redirect');
  if (redirectTo && redirectTo.startsWith('/')) {
    return redirectTo;
  }
  return '/';
}

async function loader({ request }: LoaderFunctionArgs) {
  const sessionResponse = await authClient.getSession()

  if (sessionResponse.data) {
    return redirect(redirectUrl(request));
  }

  // If it's a new installation redirect to signup
  const statusResponse = await apiFetch<{ is_active: boolean }>('/api/status');

  if (!statusResponse.ok) {
    throw data(statusResponse.error, {
      status: statusResponse.status,
    });
  }

  if (!statusResponse.data.is_active) {
    return redirect("/signup");
  }
}

async function action({
  request,
}: ActionFunctionArgs): Promise<ActionResponse> {
  const formData = await request.formData();
  const email = formData.get('email') as string || '';
  const password = formData.get('password') as string || '';

  const { error } = await authClient.signIn.email({
      email,
      password,
  });

  if (error) {
    return { ok: false, error: betterAuthErrorToBaseError(error) };
  }

  return { ok: true, data: redirect(redirectUrl(request)) };
}

function Component() {
  const actionData = useActionData<typeof action>();

  return (
    <div className="container mx-auto p-4 max-w-md mt-16">
      <Card>
        <CardHeader>
          <CardTitle className="text-center">Login</CardTitle>
        </CardHeader>
        <CardContent>
          <Form className="flex flex-col gap-4" method="post">
            {/* General error alert */}
            {actionData?.ok === false && (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertTitle>Login failed.</AlertTitle>
                <AlertDescription>{actionData.error.message}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-col gap-1">
              <Label htmlFor="email" className="text-sm font-medium">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                name="email"
                placeholder="Enter your email"
                required
              />
              {actionData?.ok === false && actionData?.error.fieldErrors?.email && (
                <p id="email-error" className="text-sm text-destructive">
                  {actionData.error.fieldErrors.email}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="password" className="text-sm font-medium">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                name="password"
                placeholder="Enter your password"
                required
              />
              {actionData?.ok === false && actionData?.error.fieldErrors?.password && (
                <p id="password-error" className="text-sm text-destructive">
                  {actionData.error.fieldErrors.password}
                </p>
              )}
            </div>

            <Button type="submit">
              Login
            </Button>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

export const loginRoute : RouteObject = {
  Component,
  loader,
  action,
}