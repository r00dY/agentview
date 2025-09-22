import { redirect, useLoaderData, Outlet, Link, Form, data, NavLink } from "react-router";
import type { Route } from "./+types/sessions";

import { Button } from "~/components/ui/button";
import { Circle, CircleCheck, PlusIcon } from "lucide-react";
import { Header, HeaderTitle } from "~/components/header";
import { getThreadListParams } from "~/lib/utils";
import { apiFetch } from "~/lib/apiFetch";
import type { Session } from "~/lib/shared/apiTypes";
import { getAllSessionItems } from "~/lib/shared/sessionUtils";
import { timeAgoShort } from "~/lib/timeAgo";
import { useSessionContext } from "~/lib/session";
import { NotificationBadge } from "~/components/NotificationBadge";

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const listParams = getThreadListParams(request);
  const threadsResponse = await apiFetch<Session[]>(`/api/sessions?list=${listParams.list}&type=${listParams.type}`);

  if (!threadsResponse.ok) {
    throw data(threadsResponse.error, { status: threadsResponse.status });
  }

  return {
    threads: threadsResponse.data,
    listParams
  }
}

export function ThreadCard({ thread, listParams }: { thread: Session, listParams: ReturnType<typeof getThreadListParams> }) {
  const { user } = useSessionContext();
  const date = thread.created_at;

  const unseenEvents = (thread as any).unseenEvents;
  const hasThreadUnreads = unseenEvents.session.length > 0;
  const allActivityEvents = (Object.values(unseenEvents.items) as any[]).flat() as any[];

  const hasActivitiesUnread = allActivityEvents.length > 0;

  const activitiesEventsCount = allActivityEvents.length;
  const activitiesMentionsCount = allActivityEvents.filter((event: any) => Array.isArray(event?.payload?.user_mentions) && (event.payload.user_mentions as any[]).includes(user.id)).length;
  const hasUnreads = hasThreadUnreads || hasActivitiesUnread;

  return <div key={thread.id}>
    <NavLink to={`/sessions/${thread.id}?list=${listParams.list}&type=${listParams.type}`}>
      {({ isActive }) => (
        <div className={`p-3 border-b hover:bg-gray-50 transition-colors duration-50 ${isActive ? 'bg-gray-100' : ''}`}>
          <div className="flex flex-col gap-1">

            <div className="flex flex-row gap-1 justify-between">
              <div className={`text-sm ${hasUnreads ? 'font-semibold' : 'font-normal'}`}>Session {thread.number}</div>

              <div className="flex flex-row gap-1 items-center">
                <div className="text-xs text-gray-500">{timeAgoShort(date)}</div>
                {activitiesEventsCount > 0 && <NotificationBadge>{activitiesEventsCount}</NotificationBadge> }
                { activitiesMentionsCount > 0 && <NotificationBadge>@</NotificationBadge> }
              </div>

            </div>
          </div>
        </div>
      )}
    </NavLink>
  </div>
}

export default function Threads() {
  const { threads, listParams } = useLoaderData<typeof clientLoader>();

  return <div className="flex flex-row items-stretch h-full">

    <div className="basis-[335px] flex-shrink-0 flex-grow-0 border-r flex flex-col ">

      <Header className="px-3">
        <HeaderTitle title={`${listParams.list === "real" ? "Sessions" : listParams.list === "simulated_private" ? "Private Sessions" : "Shared Sessions"}`} />
        {listParams.list !== "real" && <div>
          <Button variant="outline" size="sm" asChild><Link to={`/sessions/new?list=${listParams.list}&type=${listParams.type}`}><PlusIcon />New Session</Link></Button>
        </div>}
      </Header>

      <div className="flex-1 overflow-y-auto">
        {threads.length > 0 && threads.map((thread) => <ThreadCard thread={thread} listParams={listParams} />)}
        {threads.length === 0 && <div className="px-3 py-4 text-muted-foreground">No sessions available.</div>}
      </div>

    </div>

    <Outlet />

    {/* <div className="flex-1 flex flex-col">  
      <Outlet />
    </div> */}

  </div>
}
