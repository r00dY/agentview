import { redirect, useLoaderData, Link, data } from "react-router";
import type { Route } from "./+types/emails";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "~/components/ui/table";
import { Header, HeaderTitle } from "~/components/header";
import { apiFetch } from "~/lib/apiFetch";

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const response = await apiFetch(`/api/dev/emails`);
  
  if (!response.ok) {
    throw data('Failed to fetch emails', {
      status: response.status, // TODO: standardised error handling from clientLoaders!!! 
    });
  }
  return { emails: response.data };
}

export default function Emails() {
  const { emails } = useLoaderData<typeof clientLoader>();

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
              {emails.map((email: any) => (
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