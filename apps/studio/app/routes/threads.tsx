import { redirect, useLoaderData, Outlet, Link, Form , data, NavLink} from "react-router";
import type { Route } from "./+types/threads";

import { Button } from "~/components/ui/button";
import { Circle, CircleCheck, PlusIcon } from "lucide-react";
import { Header, HeaderTitle } from "~/components/header";
import { getThreadsList } from "~/lib/utils";
import { apiFetch } from "~/lib/apiFetch";
import type { Thread } from "~/lib/shared/apiTypes";
import { getAllActivities } from "~/lib/shared/threadUtils";
import { timeAgoShort } from "~/lib/timeAgo";
import { useSessionContext } from "~/lib/session";

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const list = getThreadsList(request);
  const threadsResponse = await apiFetch<Thread[]>(`/api/threads?list=${list}`);

  if (!threadsResponse.ok) {
    throw data(threadsResponse.error, { status: threadsResponse.status });
  }

  return {
    threads: threadsResponse.data,
    list
  }
}

export function ThreadCard({ thread, list }: { thread: Thread, list: string }) {
  const { user } = useSessionContext();
  const date = thread.created_at;

  const hasThreadUnreads = thread.unseenEvents.thread.length > 0;
  const hasActivitiesUnread = Object.values(thread.unseenEvents.activities).some((events) => events.length > 0);
  const hasUnreads = hasThreadUnreads || hasActivitiesUnread;

  return <div key={thread.id}>
    <NavLink to={`/threads/${thread.id}?list=${list}`}>
      {({ isActive }) => (
      <div className={`p-3 border-b hover:bg-gray-50 transition-colors duration-50 ${isActive ? 'bg-gray-100' : ''}`}>
        <div className="flex flex-col gap-1">
              {/* <div className={`text-sm  ${isUnread ? 'font-semibold' : ''}`}>Session {thread.number}</div>
              <div className="text-xs text-gray-500">{timeAgoShort(date)}</div> */}
              <div className={`text-sm ${ hasUnreads ? 'font-semibold' : 'font-normal' }`}>Session {thread.number}</div>
              <div className="flex flex-row gap-1 items-center">

               <div className="text-xs text-gray-500">{timeAgoShort(date)}</div>
               {/* {isThreadUnread ? <span className="inline-block size-1 rounded-full bg-gray-400" /> : null} */}

              </div>
        </div>
      </div>
      )}
    </NavLink>
  </div>
}

export default function Threads() {
  const { threads, list } = useLoaderData<typeof clientLoader>();

  console.log('##### RENDER #####')
  return <div className="flex flex-row items-stretch h-full">

    <div className="basis-[335px] flex-shrink-0 flex-grow-0 border-r flex flex-col ">

      <Header className="px-3">
        <HeaderTitle title={`${list === "real" ? "Threads" : list === "simulated_private" ? "Private Sessions" : "Shared Sessions" }`} />
        { list !== "real" && <div>
          <Button variant="outline" size="sm" asChild><Link to={`/threads/new?list=${list}`}><PlusIcon />New thread</Link></Button>
        </div>}
      </Header>

      <div className="flex-1 overflow-y-auto">
        { threads.length > 0 && threads.map((thread) => <ThreadCard thread={thread} list={list} />)}
        { threads.length === 0 && <div className="px-3 py-4 text-muted-foreground">No threads available.</div>}
      </div>

    </div>

        <Outlet />

    {/* <div className="flex-1 flex flex-col">  
      <Outlet />
    </div> */}

  </div>
}
