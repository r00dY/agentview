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
import { Header, HeaderTitle } from "~/components/Header";

export async function loader({ request }: Route.LoaderArgs) {
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

  return <div>

    <Header>
      <HeaderTitle title="Emails" />
    </Header>

    <div className="p-6 max-w-6xl">
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>To</TableHead>
                <TableHead>Subject</TableHead>
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
                      <span className="font-medium">{email.to}</span>
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
        </div>
      </div>
    </div>
} 