import { redirect, useLoaderData, Link, data } from "react-router";
import type { Route } from "./+types/emailDetail";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Header, HeaderTitle } from "~/components/header";
import { getAPIBaseUrl } from "~/lib/getAPIBaseUrl";

export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {

  const response = await fetch(`${getAPIBaseUrl()}/api/dev/emails/${params.id}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // Get the specific email
  const emailData = await response.json();

  console.log(emailData)

  if (!response.ok) {
    throw data(null, { status: 404 });
  }

  return { email: emailData };
}

export default function EmailDetail() {
  const { email: emailData } = useLoaderData<typeof clientLoader>();

  console.log(emailData)

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
              <p className="text-sm font-medium">{emailData.to}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">From</label>
              <p className="text-sm">{emailData.from}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Subject</label>
              <p className="text-sm">{emailData.subject || '(No subject)'}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Date</label>
              <p className="text-sm">
                {new Date(emailData.created_at).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </p>
            </div>
            {emailData.cc && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">CC</label>
                <p>{emailData.cc}</p>
              </div>
            )}
            {emailData.bcc && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">BCC</label>
                <p>{emailData.bcc}</p>
              </div>
            )}
            {emailData.reply_to && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Reply To</label>
                <p>{emailData.reply_to}</p>
              </div>
            )}
          </div>

          <div className="mt-6">
            <label className="text-sm font-medium text-muted-foreground">Content</label>
            <div className="mt-2 border rounded-md p-4 bg-white">
              {emailData.body ? (
                <div 
                  dangerouslySetInnerHTML={{ __html: emailData.body }}
                  className="prose prose-sm max-w-none"
                />
              ) : emailData.text ? (
                <div className="whitespace-pre-wrap text-sm">
                  {emailData.text}
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