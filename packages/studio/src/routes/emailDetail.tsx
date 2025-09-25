import { useLoaderData, data } from "react-router";
import type { LoaderFunctionArgs, RouteObject } from "react-router";
import { Card, CardContent } from "~/components/ui/card";
import { Header, HeaderTitle } from "~/components/header";
import { apiFetch } from "~/lib/apiFetch";

async function loader({ params }: LoaderFunctionArgs) {
  const response = await apiFetch(`/api/dev/emails/${params.id}`);

  if (!response.ok) {
    throw data(null, { status: 404 });
  }

  return { email: response.data };
}

function Component() {
  const { email } = useLoaderData<typeof loader>();

  return <div>

    <Header>
      <HeaderTitle title="Email" />
    </Header>
    <div className="p-6 max-w-6xl">



      <Card>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">To</label>
              <p className="text-sm font-medium">{email.to}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">From</label>
              <p className="text-sm">{email.from}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Subject</label>
              <p className="text-sm">{email.subject || '(No subject)'}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Date</label>
              <p className="text-sm">
                {new Date(email.createdAt).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </p>
            </div>
            {email.cc && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">CC</label>
                <p>{email.cc}</p>
              </div>
            )}
            {email.bcc && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">BCC</label>
                <p>{email.bcc}</p>
              </div>
            )}
            {email.reply_to && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Reply To</label>
                <p>{email.reply_to}</p>
              </div>
            )}
          </div>

          <div className="mt-6">
            <label className="text-sm font-medium text-muted-foreground">Content</label>
            <div className="mt-2 border rounded-md p-4 bg-white">
              {email.body ? (
                <div
                  dangerouslySetInnerHTML={{ __html: email.body }}
                  className="prose prose-sm max-w-none"
                />
              ) : email.text ? (
                <div className="whitespace-pre-wrap text-sm">
                  {email.text}
                </div>
              ) : (
                <div className="text-muted-foreground italic">
                  No content available
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
}

export const emailDetailRoute: RouteObject = {
  Component,
  loader,
} 