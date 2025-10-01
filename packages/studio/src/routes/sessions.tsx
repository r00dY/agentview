import { useLoaderData, Outlet, Link, Form, data, NavLink, redirect } from "react-router";
import type { LoaderFunctionArgs, RouteObject } from "react-router";

import { Button } from "~/components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import { Header, HeaderTitle } from "~/components/header";
import { getListParams, getListParamsAndCheckForRedirect, toQueryParams } from "~/lib/listParams";
import { apiFetch } from "~/lib/apiFetch";
import type { Pagination, SessionBase, SessionsPaginatedResponse } from "~/lib/shared/apiTypes";
import { timeAgoShort } from "~/lib/timeAgo";
import { useSessionContext } from "~/lib/SessionContext";
import { NotificationBadge } from "~/components/NotificationBadge";

async function loader({ request }: LoaderFunctionArgs) {
  const { listParams, needsRedirect } = getListParamsAndCheckForRedirect(request);

  if (needsRedirect) {
    return redirect(`/sessions?${toQueryParams(listParams)}`);
  }

  const sessionsResponse = await apiFetch<SessionsPaginatedResponse>(`/api/sessions?${toQueryParams(listParams)}`);
  if (!sessionsResponse.ok) {
    throw data(sessionsResponse.error, { status: sessionsResponse.status });
  }

  const statsResponse = await apiFetch<any>(`/api/sessions/stats?${toQueryParams(listParams)}&granular=true`);
  if (!statsResponse.ok) {
    throw data(statsResponse.error, { status: statsResponse.status });
  }

  return {
    sessions: sessionsResponse.data.sessions,
    pagination: sessionsResponse.data.pagination,
    allStats: statsResponse.data,
    listParams
  }
}

function Component() {
  const { sessions, pagination, listParams, allStats } = useLoaderData<typeof loader>();

  return <div className="flex flex-row items-stretch h-full">

    <div className="basis-[335px] flex-shrink-0 flex-grow-0 border-r flex flex-col ">

      <Header className="px-3">
        <HeaderTitle title={`${listParams.list === "real" ? "Sessions" : listParams.list === "simulated_private" ? "Private Sessions" : "Shared Sessions"}`} />
        {listParams.list !== "real" && <div>
          <Button variant="outline" size="sm" asChild><Link to={`/sessions/new?${toQueryParams(listParams)}`}><PlusIcon />New Session</Link></Button>
        </div>}
      </Header>

      <div className="flex-1 overflow-y-auto pb-12">
        {sessions.length > 0 && sessions.map(session => <SessionCard session={session} listParams={listParams} sessionStats={allStats.sessions[session.id]} />)}
        {sessions.length === 0 && <div className="px-3 py-4 text-muted-foreground">No sessions available.</div>}
        { sessions.length > 0 && <PaginationControls pagination={pagination} listParams={listParams} />}
      </div>

    </div>

    <Outlet />
  </div>
}

function PaginationControls({ pagination, listParams }: { pagination: Pagination, listParams: ReturnType<typeof getListParams> }) {
  const { hasNextPage, hasPreviousPage, totalCount, currentPageStart, currentPageEnd, page } = pagination;
  
  return (<div className="flex flex-row justify-center">
    <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-1">
      <div className="flex items-center gap-2">
        {hasPreviousPage && (
          <Button variant="ghost" size="xs" asChild>
            <Link to={`/sessions?${toQueryParams({...listParams, page: page - 1})}`}>
              <ChevronLeftIcon/>
            </Link>
          </Button>
        )}
      </div>
      
      <div className="text-center">
        {currentPageStart}-{currentPageEnd} of {totalCount}
      </div>
      
      <div className="flex items-center gap-2">
        {hasNextPage && (
          <Button variant="ghost" size="xs" asChild>
            <Link to={`/sessions?${toQueryParams({...listParams, page: page + 1})}`}>
              <ChevronRightIcon/>
            </Link>
          </Button>
        )}
      </div>
    </div>
    </div>);
}



export function SessionCard({ session, listParams, sessionStats }: { session: SessionBase, listParams: ReturnType<typeof getListParams>, sessionStats: any }) {
  const { user } = useSessionContext();
  const date = session.createdAt;

  const unseenEvents = sessionStats.unseenEvents;
  const hasSessionUnreads = unseenEvents.length > 0;
  
  const allItemEvents: any[] = [];

  for(const itemStats of Object.values(sessionStats.items) as any[]) {
    allItemEvents.push(...itemStats.unseenEvents);
  }

  const hasUnreadItems = allItemEvents.length > 0;

  const itemsEventsCount = allItemEvents.length;
  const itemsMentionsCount = allItemEvents.filter((event: any) => Array.isArray(event?.payload?.user_mentions) && (event.payload.user_mentions as any[]).includes(user.id)).length;
  const hasUnreads = hasSessionUnreads || hasUnreadItems;

  return <div key={session.id}>
    <NavLink to={`/sessions/${session.id}?${toQueryParams(listParams)}`}>
      {({ isActive }) => (
        <div className={`p-3 border-b hover:bg-gray-50 transition-colors duration-50 ${isActive ? 'bg-gray-100' : ''}`}>
          <div className="flex flex-col gap-1">

            <div className="flex flex-row gap-1 justify-between">
              <div className={`text-sm ${hasUnreads ? 'font-semibold' : 'font-normal'}`}>Session {session.handle}</div>

              <div className="flex flex-row gap-1 items-center">
                <div className="text-xs text-gray-500">{timeAgoShort(date)}</div>
                {itemsEventsCount > 0 && <NotificationBadge>{itemsEventsCount}</NotificationBadge> }
                { itemsMentionsCount > 0 && <NotificationBadge>@</NotificationBadge> }
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
