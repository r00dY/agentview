import { redirect, useLoaderData, useFetcher, Outlet, Link, Form , data, NavLink} from "react-router";
import type { Route } from "./+types/threads";
import { db } from "~/lib/db.server";

import { Button } from "~/components/ui/button";
import { PlusIcon } from "lucide-react";
import { Header, HeaderTitle } from "~/components/header";

export async function loader({ request }: Route.LoaderArgs) {
  const userLocale = request.headers.get('accept-language')?.split(',')[0] || 'en-US';

  const threadRows = await db.query.thread.findMany({
    with: {
      activities: true
    },
    orderBy: (thread, { desc }) => [desc(thread.updated_at)]
  })
  
  return {
    threads: threadRows,
    userLocale: userLocale,
  }
}


export default function Threads() {
  const { threads, userLocale } = useLoaderData<typeof loader>();

  return <div className="flex flex-row items-stretch h-full">

    <div className="basis-[335px] flex-shrink-0 flex-grow-0 border-r flex flex-col ">

      <Header className="px-3">
        <HeaderTitle title={`Threads`} />
        <div>
          <Button variant="outline" size="sm" asChild><Link to="/threads/new"><PlusIcon />New thread</Link></Button>
        </div>
      </Header>

      <div className="flex-1 overflow-y-auto">
        {threads.map((thread) => (
          <div key={thread.id}>
            <NavLink to={`/threads/${thread.id}`}>
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
      </div>

    </div>

    <div className="flex-1 flex flex-col">  
      <Outlet />
    </div>

  </div>
}
