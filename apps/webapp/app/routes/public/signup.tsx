import { redirect, Form, useActionData, useSearchParams, Link, data, useLoaderData } from "react-router";
import type { Route } from "./+types/signup";
import { Button } from "@agentview/studio/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@agentview/studio/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@agentview/studio/components/ui/alert";
import { Input } from "@agentview/studio/components/ui/input";
import { Label } from "@agentview/studio/components/ui/label";
import { AlertCircleIcon, Loader2 } from "lucide-react";
import { betterAuthErrorToBaseError, type ActionResponse } from "@agentview/studio/lib/errors";
import { authClient } from "~/authClient";
import { useNavigation } from "react-router";
import { fetchInvitation } from "~/fetchInvitation";
import { CardPageLayout } from "@agentview/studio/components/CardPageLayout";

export async function clientLoader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const invitationId = url.searchParams.get('invitationId');

  // validate invitationId
  if (invitationId) {
    const invitationResponse = await fetchInvitation(invitationId);
    if (!invitationResponse.ok) {
      throw data(invitationResponse.error, { status: 400 });
    }

    return {
      invitation: invitationResponse.data
    }
  }

  return {}
}

export async function clientAction({ request }: Route.ActionArgs): Promise<ActionResponse | Response> {
  const url = new URL(request.url);
  const invitationId = url.searchParams.get('invitationId');
  const formData = await request.formData();
  const name = formData.get('name') as string || '';
  const email = formData.get('email') as string || '';
  const password = formData.get('password') as string || '';
  const confirmPassword = formData.get('confirmPassword') as string || '';

  // Validation
  if (name.trim() === '') {
    return { ok: false, error: { message: "Validation error", fieldErrors: { name: "Name is required." } } };
  }

  if (email.trim() === '') {
    return { ok: false, error: { message: "Validation error", fieldErrors: { email: "Email is required." } } };
  }

  if (password !== confirmPassword) {
    return {
      ok: false,
      error: { message: "Validation error", fieldErrors: { confirmPassword: "Passwords do not match." } }
    };
  }

  // Sign up
  const signupResponse = await authClient.signUp.email({
    email,
    password,
    name: name.trim(),
    // @ts-ignore
    invitationId: invitationId || undefined
  });

  if (signupResponse.error) {
    return { ok: false, error: betterAuthErrorToBaseError(signupResponse.error) };
  }

  // If invitation-based signup, redirect to accept invitation
  if (invitationId) {
    return redirect('/accept-invitation?invitationId=' + encodeURIComponent(invitationId));
  }

  // For open signup, the personal organization is created automatically by the backend.
  // The dashboard route redirects to the user's organization.
  return redirect('/dashboard');
}

export default function Signup() {
  const { invitation } = useLoaderData<typeof clientLoader>();
  const actionData = useActionData<typeof clientAction>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <CardPageLayout>
      <Card>  
        <CardHeader>
          <CardTitle className="text-center">Create an account</CardTitle>
          {invitation && (
            <CardDescription className="text-center">
              Complete your signup to join the organization <span className="font-semibold">{invitation.organization.name}</span>
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <Form className="flex flex-col gap-4" method="post">

            {actionData?.ok === false && actionData.error.message !== "Validation error" && (
              <Alert variant="destructive">
                <AlertCircleIcon className="h-4 w-4" />
                <AlertTitle>Signup failed</AlertTitle>
                <AlertDescription>{actionData.error.message}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-col gap-1">
              <Label htmlFor="email" className="text-sm font-medium">
                Email
              </Label>

              <Input
                id={"email"}
                type="email"
                name={"email"}
                placeholder="you@example.com"
                required
                autoComplete="email"
                defaultValue={invitation ? invitation.email : ''}
                readOnly={!!invitation}
                className={invitation ? 'text-muted-foreground' : ''}
              />

              {actionData?.ok === false && actionData?.error?.fieldErrors?.email && (
                <p className="text-sm text-destructive">
                  {actionData.error.fieldErrors.email}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="name" className="text-sm font-medium">
                Name
              </Label>
              <Input
                id="name"
                type="text"
                name="name"
                placeholder="John Doe"
                required
                autoComplete="name"
              />
              {actionData?.ok === false && actionData?.error?.fieldErrors?.name && (
                <p className="text-sm text-destructive">
                  {actionData.error.fieldErrors.name}
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
                autoComplete="new-password"
              />
              {actionData?.ok === false && actionData?.error?.fieldErrors?.password && (
                <p className="text-sm text-destructive">
                  {actionData.error.fieldErrors.password}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="confirmPassword" className="text-sm font-medium">
                Confirm Password
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                name="confirmPassword"
                placeholder="Confirm your password"
                required
                autoComplete="new-password"
              />
              {actionData?.ok === false && actionData?.error?.fieldErrors?.confirmPassword && (
                <p className="text-sm text-destructive">
                  {actionData.error.fieldErrors.confirmPassword}
                </p>
              )}
            </div>

            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating account...
                </>
              ) : (
                "Sign Up"
              )}
            </Button>
          </Form>
        </CardContent>
        <CardFooter className="justify-center">
          <p className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link to="/login" className="text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </CardFooter>
      </Card>
    </CardPageLayout>
  );
}
