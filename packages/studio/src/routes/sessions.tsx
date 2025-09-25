import { useLoaderData, Outlet, Link, Form, data, NavLink } from "react-router";
import type { LoaderFunctionArgs, RouteObject } from "react-router";

import { Button } from "~/components/ui/button";
import { PlusIcon } from "lucide-react";
import { Header, HeaderTitle } from "~/components/header";
import { getListParams } from "~/lib/utils";
import { apiFetch } from "~/lib/apiFetch";
import type { Session } from "~/lib/shared/apiTypes";
import { timeAgoShort } from "~/lib/timeAgo";
import { useSessionContext } from "~/lib/session";
import { NotificationBadge } from "~/components/NotificationBadge";

async function loader({ request }: LoaderFunctionArgs) {
  const listParams = getListParams(request);
  const sessionsResponse = await apiFetch<Session[]>(`/api/sessions?agent=${listParams.agent}&list=${listParams.list}`);

  if (!sessionsResponse.ok) {
    throw data(sessionsResponse.error, { status: sessionsResponse.status });
  }

  return {
    sessions: sessionsResponse.data,
    listParams
  }
}

function Component() {
  const { sessions, listParams } = useLoaderData<typeof loader>();

  return <div className="flex flex-row items-stretch h-full">

    <div className="basis-[335px] flex-shrink-0 flex-grow-0 border-r flex flex-col ">

      <Header className="px-3">
        <HeaderTitle title={`${listParams.list === "real" ? "Sessions" : listParams.list === "simulated_private" ? "Private Sessions" : "Shared Sessions"}`} />
        {listParams.list !== "real" && <div>
          <Button variant="outline" size="sm" asChild><Link to={`/sessions/new?agent=${listParams.agent}&list=${listParams.list}`}><PlusIcon />New Session</Link></Button>
        </div>}
      </Header>

      <div className="flex-1 overflow-y-auto">
        {sessions.length > 0 && sessions.map((session) => <SessionCard session={session} listParams={listParams} />)}
        {sessions.length === 0 && <div className="px-3 py-4 text-muted-foreground">No sessions available.</div>}
      </div>

    </div>

    <Outlet />
  </div>
}


export function SessionCard({ session, listParams }: { session: Session, listParams: ReturnType<typeof getListParams> }) {
  const { user } = useSessionContext();
  const date = session.created_at;

  const unseenEvents = (session as any).unseenEvents;
  const hasSessionUnreads = unseenEvents.session.length > 0;
  const allItemEvents = (Object.values(unseenEvents.items) as any[]).flat() as any[];

  const hasActivitiesUnread = allItemEvents.length > 0;

  const activitiesEventsCount = allItemEvents.length;
  const activitiesMentionsCount = allItemEvents.filter((event: any) => Array.isArray(event?.payload?.user_mentions) && (event.payload.user_mentions as any[]).includes(user.id)).length;
  const hasUnreads = hasSessionUnreads || hasActivitiesUnread;

  return <div key={session.id}>
    <NavLink to={`/sessions/${session.id}?list=${listParams.list}&agent=${listParams.agent}`}>
      {({ isActive }) => (
        <div className={`p-3 border-b hover:bg-gray-50 transition-colors duration-50 ${isActive ? 'bg-gray-100' : ''}`}>
          <div className="flex flex-col gap-1">

            <div className="flex flex-row gap-1 justify-between">
              <div className={`text-sm ${hasUnreads ? 'font-semibold' : 'font-normal'}`}>Session {session.number}</div>

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

export const sessionsRoute: RouteObject = {
  Component,
  loader,
}
