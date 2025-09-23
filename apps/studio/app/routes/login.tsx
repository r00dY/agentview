import { redirect, Form, useActionData, data } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import type { Route } from "./+types/login";
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

export async function clientLoader({ request }: Route.LoaderArgs) {
  const sessionResponse = await authClient.getSession()

  if (sessionResponse.data) {
    return redirect(redirectUrl(request));
  }

  // If it's a new installation redirect to signup
  const statusResponse = await apiFetch<{ is_active: boolean }>('/api/status');

  if (!statusResponse.ok) {
    throw data(statusResponse.error, {
      status: statusResponse.status, // TODO: standardised error handling from clientLoaders!!! 
    });
  }

  if (!statusResponse.data.is_active) {
    return redirect("/signup");
  }

}

export async function clientAction({
  request,
  params
}: Route.ActionArgs): Promise<ActionResponse> {
  const formData = await request.formData();
  const email = formData.get('email') as string || '';
  const password = formData.get('password') as string || '';

  // Validation
  const fieldErrors: Record<string, string> = {};
  
  if (!email) {
    fieldErrors.email = 'Email is required';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fieldErrors.email = 'Please enter a valid email address';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, error: { message: "Validation error", fieldErrors } };
  }

  const { error } = await authClient.signIn.email({
      email,
      password,
  });

  if (error) {
    return { ok: false, error: betterAuthErrorToBaseError(error) };
  }

  return { ok: true, data: redirect(redirectUrl(request)) };
}

export default function LoginPage() {
  const actionData = useActionData<typeof clientAction>();

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
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Enter your email"
                required
                // aria-invalid={actionData?.status === "error" && actionData?.fieldErrors?.email ? "true" : "false"}
                // aria-describedby={actionData?.status === "error" && actionData?.fieldErrors?.email ? "email-error" : undefined}
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
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Enter your password"
                required
                // aria-invalid={actionData?.fieldErrors?.password ? "true" : "false"}
                // aria-describedby={actionData?.fieldErrors?.password ? "password-error" : undefined}
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