import { redirect, Form, useActionData, useLoaderData, data } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import type { Route } from "./+types/signup";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { AlertCircleIcon } from "lucide-react";
import { betterAuthErrorToBaseError, type ActionResponse } from "~/lib/errors";
import { authClient } from "~/lib/auth-client";
import { getAPIBaseUrl } from "~/lib/getAPIBaseUrl";
import { apiFetch } from "~/lib/apiFetch";


export async function clientLoader({ request }: Route.ClientLoaderArgs): Promise<ActionResponse | Response> {
  const session = await authClient.getSession();
  
  if (session.data) {
    return redirect('/');
  }

  const url = new URL(request.url);
  const invitationId = url.searchParams.get('invitationId');
    
  if (!invitationId) {
    return {
      ok: false,
      error: {
        message: "You must have an invitation to sign up."
      }
    }
  }

  const response = await apiFetch(`/api/invitations/${invitationId}`);

  if (!response.ok) {
    return {
      ok: false,
      error: response.error,
    }
  }

  return {
    ok: true,
    data: response.data,
  }
}

export async function clientAction({
  request,
  params
}: Route.ClientActionArgs) {
  const url = new URL(request.url);
  const invitationId = url.searchParams.get('invitationId');

  if (!invitationId) {
    return { ok: false, error: { message: "Invitation not provided." } };
  }

  const formData = await request.formData();
  const name = formData.get('name') as string || '';
  const email = formData.get('email') as string || '';
  const password = formData.get('password') as string || '';
  const confirmPassword = formData.get('confirmPassword') as string || '';

  if (name.trim() === '') {
    return { ok: false, error: { message: "Validation error", fieldErrors: { name: "Name is required." } } };
  }

  if (password !== confirmPassword) {
    return { 
      ok: false, 
      error: { message: "Validation error", fieldErrors: { confirmPassword: "Passwords do not match." } } 
    };
  }

  const { data, error } = await authClient.signUp.email({
    email,
    password,
    name: name.trim(),
      // @ts-ignore
    invitationId
  })

  if (error) {
    return { ok: false, error: betterAuthErrorToBaseError(error) };
  }

  return redirect('/');
}

export default function SignupPage() {
  const actionData = useActionData<typeof clientAction>();
  const loaderData = useLoaderData<typeof clientLoader>();

  return (
    <div className="container mx-auto p-4 max-w-md mt-16">
      <Card>
        <CardHeader>
          <CardTitle className="text-center">Sign Up</CardTitle>
        </CardHeader>

        { !loaderData.ok && <CardContent>
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertDescription>{ loaderData.error.message }</AlertDescription>
          </Alert>
        </CardContent> }
        
        { loaderData.ok && <CardContent>
          <Form className="flex flex-col gap-4" method="post">

            <input type="hidden" name="invitationId" value={loaderData.data.id} />
            <input type="hidden" name="email" value={loaderData.data.email} />

            {actionData?.ok === false && (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertTitle>Signup failed.</AlertTitle>
                <AlertDescription>{actionData.error.message}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-col gap-1">
              <Label htmlFor="name" className="text-sm font-medium">
                Name
              </Label>
              <Input
                id="name"
                type="text"
                name="name"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Enter your full name"
                required
              />
              {actionData?.ok === false && actionData?.error?.fieldErrors?.name && (
                <p id="name-error" className="text-sm text-destructive">
                  {actionData.error.fieldErrors.name}
                </p>
              )}
            </div>
{/* 
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
              />
              {actionData?.status === "error" && actionData?.fieldErrors?.email && (
                <p id="email-error" className="text-sm text-destructive">
                  {actionData.fieldErrors.email}
                </p>
              )}
            </div> */}

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
              />
              {actionData?.ok === false && actionData?.error?.fieldErrors?.password && (
                <p id="password-error" className="text-sm text-destructive">
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
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Confirm your password"
                required
              />
              {actionData?.ok === false && actionData?.error?.fieldErrors?.confirmPassword && (
                <p id="confirmPassword-error" className="text-sm text-destructive">
                  {actionData.error.fieldErrors.confirmPassword}
                </p>
              )}
            </div>

            <Button type="submit">
              Sign Up
            </Button>
          </Form>
        </CardContent> }
      </Card>
    </div>
  );
}