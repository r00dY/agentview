import { redirect, useNavigate, Form, useActionData } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import type { Route } from "./+types/login";
import { auth } from "../../lib/auth";

export const clientLoader = async () => {
//   if (getAuth()) {
//     return redirect('/')
//   }
}

export async function action({
  request,
  params
}: Route.ActionArgs) {
  const formData = await request.formData();
  const email = formData.get('email') as string || '';
  const password = formData.get('password') as string || '';

  console.log("------ server ------")

  const response = await auth.api.signInEmail({
    body: {
      email,
      password,
    },
    asResponse: true
  })

  console.log(response)

  return response

//   try {
//     const token = await login(email, password);
//     setAuth(token, email);
//     return redirect('/')

//   } catch (error) {
//     return { error: (error as Error).message }
//   }
}

export default function LoginPage() {
  const actionData = useActionData<typeof action>()

  console.log("------ client rerender ------")
  console.log(actionData)

  return <div className="container mx-auto p-4 max-w-md mt-16">
      <Card>
        <CardHeader>
          <CardTitle className="text-center">Login</CardTitle>
        </CardHeader>
        <CardContent>
          <Form className="flex flex-col gap-4" method="post">
            <div>
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                type="email"
                name="email"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Enter your email"
                required
              />
            </div>
            <div>
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <input
                id="password"
                type="password"
                name="password"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Enter your password"
                required
              />
            </div>
            {/* {actionData?.error && <div className="text-red-500">{actionData.error}</div>} */}
            <Button type="submit">
              Login
            </Button>
          </Form>
        </CardContent>
      </Card>
    </div>
}