import { redirect, Form, useActionData, useLoaderData } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import type { Route } from "./+types/signup";
import { auth } from "~/.server/auth";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { AlertCircleIcon } from "lucide-react";
import { type FormActionData, type FormActionDataError } from "~/lib/FormActionData";
import { getValidInvitation } from "~/.server/invitations";


export async function loader({ request }: Route.LoaderArgs) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });
  
  if (session) {
    return redirect('/');
  }

  const url = new URL(request.url);
  const invitationId = url.searchParams.get('invitationId');

  if (!invitationId) {
    return {
      invitationId: null,
      error: "You must have an invitation to sign up."
    }
  }

  // FIXME: I don't know how in better-auth to get invitation data (or make any operations) *as system* (without login). So talkibg directly to db.
  try {
    const invitationRow = await getValidInvitation(invitationId);

    return {
      invitation: invitationRow
    }

  } catch (error) {
    return {
      invitation: null,
      error: error instanceof Error ? error.message : "An unexpected error occurred."
    }
  }
}

export async function action({
  request,
  params
}: Route.ActionArgs) {
  const url = new URL(request.url);
  const invitationId = url.searchParams.get('invitationId');

  if (!invitationId) {
    return { status: "error", error: "Invitation not provided." };
  }

  try {
    const invitation = await getValidInvitation(invitationId);

    const formData = await request.formData();
    const name = formData.get('name') as string || '';
    const email = invitation.email;
    const password = formData.get('password') as string || '';
    const confirmPassword = formData.get('confirmPassword') as string || '';

    if (name.trim() === '') {
      return { status: "error", fieldErrors: { name: "Name is required." } };
    }

    if (password !== confirmPassword) {
      return { 
        status: "error", 
        fieldErrors: { confirmPassword: "Passwords do not match." } 
      };
    }

    const { headers } = await auth.api.signUpEmail({
      returnHeaders: true,
      body: {
        email,
        password,
        name: name.trim(),
        invitationId
      },
    });

    return redirect('/', { headers });

  } catch (error) {
    if (error instanceof Error) {
      return { status: "error", error: error.message };
    }
    return { status: "error", error: "An unexpected error occurred." };
  }

}

export default function SignupPage() {
  const actionData = useActionData<typeof action>() as FormActionData | undefined;
  const { invitation, error } = useLoaderData<typeof loader>();

  return (
    <div className="container mx-auto p-4 max-w-md mt-16">
      <Card>
        <CardHeader>
          <CardTitle className="text-center">Sign Up</CardTitle>
        </CardHeader>

        { error && <CardContent>
          <Alert variant="destructive">
            <AlertCircleIcon />
            {/* <AlertTitle>Invitation not found</AlertTitle> */}
            <AlertDescription>{ error }</AlertDescription>
          </Alert>
        </CardContent> }
        
        { invitation && !error && <CardContent>
          <Form className="flex flex-col gap-4" method="post">

            <input type="hidden" name="invitationId" value={invitation.id} />

            {actionData?.status === "error" && actionData.error && (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertTitle>Signup failed.</AlertTitle>
                <AlertDescription>{actionData.error}</AlertDescription>
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
              {actionData?.status === "error" && actionData?.fieldErrors?.name && (
                <p id="name-error" className="text-sm text-destructive">
                  {actionData.fieldErrors.name}
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
              {actionData?.status === "error" && actionData?.fieldErrors?.password && (
                <p id="password-error" className="text-sm text-destructive">
                  {actionData.fieldErrors.password}
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
              {actionData?.status === "error" && actionData?.fieldErrors?.confirmPassword && (
                <p id="confirmPassword-error" className="text-sm text-destructive">
                  {actionData.fieldErrors.confirmPassword}
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