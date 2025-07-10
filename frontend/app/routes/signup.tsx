import { redirect, Form, useActionData } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import type { Route } from "./+types/signup";
import { auth } from "../../lib/auth.server";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { AlertCircleIcon } from "lucide-react";
import { APIError } from "better-auth/api";
import { type FormActionData, type FormActionDataError } from "~/lib/FormActionData";

export async function action({
  request,
  params
}: Route.ActionArgs) {
  const formData = await request.formData();
  const email = formData.get('email') as string || '';
  const password = formData.get('password') as string || '';

  // Validation
  const fieldErrors: FormActionDataError['fieldErrors'] = {};
  
  if (!email) {
    fieldErrors.email = 'Email is required';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fieldErrors.email = 'Please enter a valid email address';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", fieldErrors };
  }

  try {
    const { headers } = await auth.api.signInEmail({
        returnHeaders: true,
        body: {
            email,
            password,
        },
    });

    return redirect('/', { headers });
    
  } catch (error) {
    if (error instanceof APIError) {
      return { status: "error", error: error.message };
    }
    return { status: "error", error: 'An unexpected error occurred. Please try again.' };
  }
}

export default function LoginPage() {
  const actionData = useActionData<typeof action>() as FormActionData | undefined;

  return (
    <div className="container mx-auto p-4 max-w-md mt-16">
      <Card>
        <CardHeader>
          <CardTitle className="text-center">Login</CardTitle>
        </CardHeader>
        <CardContent>
          <Form className="flex flex-col gap-4" method="post">
            {/* General error alert */}
            {actionData?.status === "error" && actionData.error && (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertTitle>Login failed.</AlertTitle>
                <AlertDescription>{actionData.error}</AlertDescription>
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
              />
              {actionData?.status === "error" && actionData?.fieldErrors?.email && (
                <p id="email-error" className="text-sm text-destructive">
                  {actionData.fieldErrors.email}
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
              />
              {actionData?.status === "error" && actionData?.fieldErrors?.password && (
                <p id="password-error" className="text-sm text-destructive">
                  {actionData.fieldErrors.password}
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