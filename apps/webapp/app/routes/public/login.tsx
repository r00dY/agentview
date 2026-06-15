import { redirect, Form, useActionData, Link, useSearchParams, useNavigation } from "react-router";
import type { Route } from "./+types/login";
import { Button } from "@agentview/studio/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from "@agentview/studio/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@agentview/studio/components/ui/alert";
import { Input } from "@agentview/studio/components/ui/input";
import { Label } from "@agentview/studio/components/ui/label";
import { AlertCircleIcon, Loader2 } from "lucide-react";
import { betterAuthErrorToBaseError, type ActionResponse } from "@agentview/studio/lib/errors";
import { authClient } from "~/authClient";
import { CardPageLayout } from "@agentview/studio/components/CardPageLayout";

function getRedirectUrl(request: Request) {
  const url = new URL(request.url);

  // If origin is present, redirect to auth
  const origin = url.searchParams.get('origin');
  if (origin) {
    return `/auth?origin=${encodeURIComponent(origin)}`;
  }

  // If invitationId is present, redirect to accept-invitation after login
  const invitationId = url.searchParams.get('invitationId');
  if (invitationId) {
    return `/accept-invitation?invitationId=${encodeURIComponent(invitationId)}`;
  }

  // Otherwise use the redirect param or default to /
  const redirectTo = url.searchParams.get('redirect');
  if (redirectTo && redirectTo.startsWith('/')) {
    return redirectTo;
  }
  return '/dashboard';
}

export async function clientAction({
  request,
  params
}: Route.ActionArgs): Promise<ActionResponse | Response> {
  const formData = await request.formData();
  const email = formData.get('email') as string || '';
  const password = formData.get('password') as string || '';

  const { data, error } = await authClient.signIn.email({
      email,
      password,
  });

  if (error) {
    return { ok: false, error: betterAuthErrorToBaseError(error) };
  }

  return redirect(getRedirectUrl(request));
}

export default function LoginPage() {
  const actionData = useActionData<typeof clientAction>();
  const [searchParams] = useSearchParams();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // Build signup link with same params (for invitation + CLI connect flows)
  const signupParams = new URLSearchParams();
  const redirectParam = searchParams.get('redirect');
  const invitationId = searchParams.get('invitationId');
  const organizationId = searchParams.get('organizationId');
  if (redirectParam) signupParams.set('redirect', redirectParam);
  if (invitationId) signupParams.set('invitationId', invitationId);
  if (organizationId) signupParams.set('organizationId', organizationId);
  const signupUrl = signupParams.toString() ? `/signup?${signupParams.toString()}` : '/signup';
  const isCliConnect = (redirectParam ?? '').startsWith('/cli');

  return (
    <CardPageLayout>
      <Card>
        <CardHeader>
          <CardTitle className="text-center">Sign in</CardTitle>
          {isCliConnect && (
            <CardDescription className="text-center">
              Sign in to connect the AgentView CLI.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <Form className="flex flex-col gap-4" method="post">
            {/* General error alert */}
            {actionData?.ok === false && (
              <Alert variant="destructive">
                <AlertCircleIcon className="h-4 w-4" />
                <AlertTitle>Login failed</AlertTitle>
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
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
              {actionData?.ok === false && actionData?.error.fieldErrors?.email && (
                <p className="text-sm text-destructive">
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
                autoComplete="current-password"
              />
              {actionData?.ok === false && actionData?.error.fieldErrors?.password && (
                <p className="text-sm text-destructive">
                  {actionData.error.fieldErrors.password}
                </p>
              )}
            </div>

            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </Form>
        </CardContent>
        <CardFooter className="justify-center">
          <p className="text-sm text-muted-foreground">
            Don't have an account?{" "}
            <Link to={signupUrl} className="text-primary hover:underline">
              Sign up
            </Link>
          </p>
        </CardFooter>
      </Card>
    </CardPageLayout>
  );
}
