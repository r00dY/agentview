import { useLoaderData, Outlet, Link, Form, data, NavLink, redirect, Await } from "react-router";
import type { LoaderFunctionArgs, RouteObject } from "react-router";
import { Suspense, useEffect } from "react";

import { Button } from "../components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon, Loader2, MessageCircle, PlusIcon, UserIcon } from "lucide-react";
import { Header, HeaderTitle } from "../components/header";
import { getListParams, getListParamsAndCheckForRedirect, toQueryParams } from "../lib/listParams";
import { agentview, AgentViewError } from "../lib/agentview";
import type { Pagination, SessionBase, SessionsPaginatedResponse, SessionStats, Space } from "agentview/apiTypes";
import { timeAgoShort } from "../lib/timeAgo";
import { useSessionContext } from "../lib/SessionContext";
import { NotificationBadge, NotificationDot } from "../components/internal/NotificationBadge";
import { UserAvatar } from "../components/internal/UserAvatar";
import { LoadingIndicator } from "../components/internal/LoadingIndicator";

async function loader({ request }: LoaderFunctionArgs) {
  const { listParams, redirectUrl } = getListParamsAndCheckForRedirect(request);

  if (redirectUrl) {
    return redirect(redirectUrl.toString());
  }

  try {
    const currentParams = new URLSearchParams(window.location.search);
    const isSamePage =
      currentParams.get('space') === (listParams.space ?? null) &&
      currentParams.get('page') === (listParams.page?.toString() ?? null);
    const shouldLoadImmediately = !isSamePage;

    // Sessions: sync on first load, async on revalidation
    const sessionsResult = shouldLoadImmediately
      ? agentview.getSessionsSync({
          space: listParams.space as Space,
          page: listParams.page,
        })
      : await agentview.getSessions({
          space: listParams.space as Space,
          page: listParams.page,
        });

    // Stats: always sync, never blocking
    const allStats = agentview.getSessionsStatsSync({
      space: listParams.space as Space,
      page: listParams.page,
      granular: true,
    });

    return {
      sessions: sessionsResult?.sessions,
      pagination: sessionsResult?.pagination,
      allStats,
      listParams
    };
  } catch (error) {
    if (error instanceof AgentViewError) {
      throw data({ message: error.message, ...error.details }, { status: error.statusCode });
    }
    throw error;
  }
}

function Component() {
  const { sessions, pagination, listParams, allStats } = useLoaderData<typeof loader>();

  return <div className="flex flex-row items-stretch h-full">

    <div className="basis-[300px] flex-shrink-0 flex-grow-0 min-w-0 border-r flex flex-col ">

      <Header className="px-3">
        <HeaderTitle title={`${listParams.space === "production" ? "Sessions" : listParams.space === "playground" ? "Private Playground" : "Shared Playground"}`} />
      </Header>

      <div className="flex-1 overflow-y-auto pb-12">

        {!sessions && <div className="px-3 py-4 text-muted-foreground"><LoadingIndicator /></div>}

        {sessions && sessions.length === 0 && <div className="px-3 py-4 text-muted-foreground">No sessions available.</div>}
        {sessions && sessions.length > 0 && <SessionList sessions={sessions} listParams={listParams} allStats={allStats} /> }

        {/* <Suspense fallback={<SessionList sessions={sessions} listParams={listParams} allStats={undefined} />}>
          <Await resolve={allStats}>
            {(resolvedStats) => <SessionList sessions={sessions} listParams={listParams} allStats={resolvedStats} />}
          </Await>
        </Suspense>
        {sessions.length === 0 && <div className="px-3 py-4 text-muted-foreground">No sessions available.</div>}
        {sessions.length > 0 && <PaginationControls pagination={pagination} listParams={listParams} />} */}
      </div>

    </div>

    <Outlet context={{ allStats: allStats ?? undefined, sessions }} />
  </div>
}

function SessionList({ sessions, listParams, allStats }: { sessions: SessionBase[], listParams: ReturnType<typeof getListParams>, allStats: any }) {
  if (sessions.length === 0) return null;
  return <>{sessions.map(session => <SessionCard key={session.id} session={session} listParams={listParams} sessionStats={allStats?.sessions?.[session.id]} />)}</>;
}

function PaginationControls({ pagination, listParams }: { pagination: Pagination, listParams: ReturnType<typeof getListParams> }) {
  const { hasNextPage, hasPreviousPage, totalCount, currentPageStart, currentPageEnd, page } = pagination;

  return (<div className="flex flex-row justify-center">
    <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-1">
      <div className="flex items-center gap-2">
        {hasPreviousPage && (
          <Button variant="ghost" size="xs" asChild>
            <Link to={`/sessions?${toQueryParams({ ...listParams, page: page - 1 })}`}>
              <ChevronLeftIcon />
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
            <Link to={`/sessions?${toQueryParams({ ...listParams, page: page + 1 })}`}>
              <ChevronRightIcon />
            </Link>
          </Button>
        )}
      </div>
    </div>
  </div>);
}



export function SessionCard({ session, listParams, sessionStats }: { session: SessionBase, listParams: ReturnType<typeof getListParams>, sessionStats: SessionStats | undefined }) {
  const { organization: { members }, me } = useSessionContext();
  const date = session.createdAt;

  const inboxItems = sessionStats?.inboxItems ?? [];

  // Session-level unreads: no runId, sessionItemId, or channelMessageId
  const sessionLevelItems = inboxItems.filter(i => !i.runId && !i.sessionItemId && !i.channelMessageId);
  const hasSessionUnreads = sessionLevelItems.some(i => i.unseenEvents.length > 0);

  // Item-level unreads: everything else
  const itemLevelItems = inboxItems.filter(i => i.runId || i.sessionItemId || i.channelMessageId);
  const allItemEvents: any[] = itemLevelItems.flatMap(i => i.unseenEvents);

  const hasUnreadItems = allItemEvents.length > 0;

  const itemsEventsCount = allItemEvents.length;
  const itemsMentionsCount = allItemEvents.filter((event: any) => Array.isArray(event?.payload?.user_mentions) && (event.payload.user_mentions as any[]).includes(me.id)).length;
  const hasUnreads = hasSessionUnreads || hasUnreadItems;

  const author = members.find((member) => member.userId === session.user.createdBy);

  return <div key={session.id}>
    <NavLink to={`/sessions/${session.id}?${toQueryParams(listParams)}`}>
      {({ isActive, isPending }) => (
        <div className={`p-3 border-b hover:bg-neutral-50 transition-colors duration-50 ${isActive ? 'bg-neutral-100' : ''}`}>
          <div className="flex flex-col gap-1">

            <div className="flex flex-row gap-1 justify-between">

              <div className="flex flex-row gap-2 items-center">
                { !author && <MessageCircle className="size-4 text-neutral-500" />}
                { author && <UserAvatar image={author?.user.image} className="flex-shrink-0" size="sm" />}

                <div className={`text-sm ${hasUnreads ? 'font-semibold' : 'font-normal'}`}>
                  Session {session.handle}
                </div>

                {/* {isPending && <Loader2 className="size-3 animate-spin text-neutral-500" />} */}

              </div>

              <div className="flex flex-row gap-1 items-center">
                <div className="text-xs text-neutral-500">{timeAgoShort(date)}</div>
                {itemsMentionsCount > 0 && <NotificationBadge>@</NotificationBadge>}
                {itemsMentionsCount === 0 && itemsEventsCount > 0 && <NotificationDot />}
              </div>

            </div>
            { session.summary && <div className="text-sm truncate  text-neutral-600">{session.summary}</div> }
            {/* <div className="text-xs text-neutral-500 mt-1">0.0.1-dev</div> */}
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
