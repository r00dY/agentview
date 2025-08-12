import { redirect, useLoaderData, useFetcher, Outlet, Link, Form , data, NavLink} from "react-router";
import type { Route } from "./+types/threads";
import { db } from "~/lib/db.server";

import { Button } from "~/components/ui/button";
import { PlusIcon } from "lucide-react";
import { Header, HeaderTitle } from "~/components/header";
import { getThreadsList } from "~/lib/utils";
import { thread } from "~/.server/db/schema";
import { auth } from "~/.server/auth";

export async function loader({ request }: Route.LoaderArgs) {
  const list =  getThreadsList(request);
  const userLocale = request.headers.get('accept-language')?.split(',')[0] || 'en-US';

  const session = await auth.api.getSession({
    headers: request.headers,
  });

  const userId = session!.user.id;

  const threadRows = await db.query.thread.findMany({
    with: {
      activities: {
        orderBy: (activity, { desc }) => [desc(activity.created_at)],
      },
      client: {
        with: {
          simulatedBy: true
        }
        // where: (client, { eq, isNull, not }) => isNull(client.simulated_by)
        // with: {
        //   simulatedBy: true,
        // }
        
      }
      // client: {
      //   where: (client, { eq, isNull, not }) =>
      //     type === "real"
      //       ? isNull(client.simulated_by)
      //       : eq(client.simulated_by, userId)
      // }
    },
    orderBy: (thread, { desc }) => [desc(thread.updated_at)]
    // where: (thread, { isNull }) => isNull(thread.client.simulatedBy)
    // where: (thread, { eq, isNull, not }) =>
    //   type === "real"
    //     ? isNull(thread.client.simulatedBy.id)
    //     : eq(thread.client.simulatedBy.id, userId)
    // where: (client, { eq }) => eq(client.simulated_by, type)
  })

  const threadRowsFiltered = threadRows.filter(thread => {
    if (list === "real") {
      return thread.client.simulatedBy === null;
    } else if (list === "simulated_private") {
      return thread.client.simulatedBy !== null && thread.client.simulatedBy.id === userId;
    } else if (list === "simulated_shared") {
      return thread.client.simulatedBy !== null && thread.client.is_shared;
    }
  })
  
  return {
    threads: threadRowsFiltered,
    userLocale: userLocale,
    list
  }
}

export default function Threads() {
  const { threads, userLocale, list } = useLoaderData<typeof loader>();

  return <div className="flex flex-row items-stretch h-full">

    <div className="basis-[335px] flex-shrink-0 flex-grow-0 border-r flex flex-col ">

      <Header className="px-3">
        <HeaderTitle title={`${list === "real" ? "Threads" : list === "simulated_private" ? "Test Threads" : "Test Threads" }`} />
        { list !== "real" && <div>
          <Button variant="outline" size="sm" asChild><Link to={`/threads/new?list=${list}`}><PlusIcon />New thread</Link></Button>
        </div>}
      </Header>

      <div className="flex-1 overflow-y-auto">
        {threads.length > 0 &&threads.map((thread) => (
          <div key={thread.id}>
            <NavLink to={`/threads/${thread.id}?list=${list}`}>
              {({ isActive }) => (
              <div className={`p-3 border-b hover:bg-gray-50 transition-colors duration-50 ${isActive ? 'bg-gray-100' : ''}`}>
                <div className="flex flex-col gap-1">
                    <div className="text-sm font-medium">{thread.id}</div>
                    <div className="text-xs text-gray-500">
                      {thread.activities.length > 0 
                        ? thread.activities[0].created_at.toLocaleString(userLocale)
                        : thread.updated_at.toLocaleString(userLocale)
                      }
                    </div>
                </div>
              </div>
              )}
            </NavLink>
          </div>
        ))}
        { threads.length === 0 && <div className="px-3 py-4 text-muted-foreground">No threads available.</div>}
      </div>

    </div>

    <div className="flex-1 flex flex-col">  
      <Outlet />
    </div>

  </div>
}
