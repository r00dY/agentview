import { redirect, useLoaderData, Link } from "react-router";
import type { Route } from "./+types/emails";
import { db } from "../../lib/db.server";
import { email } from "../../db/schema";
import { desc, eq } from "drizzle-orm";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "~/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

export async function loader({ request }: Route.LoaderArgs) {
//   const session = await auth.api.getSession({
//     headers: request.headers,
//   });

//   if (!session) {
//     return redirect('/login');
//   }

//   // Check if emails feature is enabled
//   if (process.env.SHOW_EMAILS !== 'true') {
//     throw new Response("Not Found", { status: 404 });
//   }

  // Get last 100 emails, sorted newest to oldest
  const emails = await db
    .select({
      id: email.id,
      to: email.to,
      subject: email.subject,
      from: email.from,
      created_at: email.created_at,
    })
    .from(email)
    .orderBy(desc(email.created_at))
    .limit(100);

  return { emails };
}

export default function Emails() {
  const { emails } = useLoaderData<typeof loader>();

  return (
    <div className="p-6">
      <Card>
        <CardHeader>
          <CardTitle>Emails</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>To</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>From</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {emails.map((email) => (
                <TableRow key={email.id}>
                  <TableCell>
                    <Link 
                      to={`/emails/${email.id}`}
                      className="hover:underline"
                    >
                      <span className="font-bold">{email.to}</span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link 
                      to={`/emails/${email.id}`}
                      className="hover:underline"
                    >
                      {email.subject || '(No subject)'}
                    </Link>
                  </TableCell>
                  <TableCell>{email.from}</TableCell>
                  <TableCell>
                    {new Date(email.created_at).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {emails.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No emails found.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
} 