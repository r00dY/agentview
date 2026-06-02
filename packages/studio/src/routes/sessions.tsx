import { useLoaderData, Outlet, Link, Form, data, NavLink, redirect, Await, useLocation } from "react-router";
import type { LoaderFunctionArgs, RouteObject } from "react-router";
import { Suspense, useEffect } from "react";

import { Button } from "../components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon, Globe, Loader2, Mail, MessageCircle, PlusIcon, UserIcon, X } from "lucide-react";
import { Header, HeaderTitle } from "../components/header";
import { getListParams, getListParamsAndCheckForRedirect, toQueryParams } from "../lib/listParams";
import { agentview, AgentViewError } from "../lib/agentview";
import type { Pagination, SessionBase, SessionsPaginatedResponse, SessionStats, Space, User } from "agentview/apiTypes";
import { timeAgoShort } from "../lib/timeAgo";
import { useSessionContext } from "../lib/SessionContext";
import { NotificationBadge, NotificationDot } from "../components/internal/NotificationBadge";
import { UserAvatar } from "../components/internal/UserAvatar";
import { LoadingIndicator } from "../components/internal/LoadingIndicator";

type ListParams = ReturnType<typeof getListParams>;

async function loader({ request }: LoaderFunctionArgs) {
  const { listParams, redirectUrl } = getListParamsAndCheckForRedirect(request);

  if (redirectUrl) {
    return redirect(redirectUrl.toString());
  }

  try {
    // userId and space are mutually exclusive at the API level
    const listOptions = listParams.userId
      ? { userId: listParams.userId, page: listParams.page }
      : { space: listParams.space, shared: listParams.shared, page: listParams.page };

    const currentParams = new URLSearchParams(window.location.search);
    const isSamePage =
      currentParams.get('space') === (listParams.space ?? null) &&
      currentParams.get('shared') === (listParams.shared === undefined ? null : String(listParams.shared)) &&
      currentParams.get('userId') === (listParams.userId ?? null) &&
      currentParams.get('page') === (listParams.page?.toString() ?? null);
    const shouldLoadImmediately = !isSamePage;

    const sessionsResult = shouldLoadImmediately
      ? agentview().sessions.listCached(listOptions)
      : await agentview().sessions.list(listOptions);

    const allStats = agentview().sessions.getStatsCached({
      ...listOptions,
      granular: true,
    });

    const user = listParams.userId
      ? (shouldLoadImmediately
        ? agentview().users.getCached(listParams.userId)
        : await agentview().users.get(listParams.userId))
      : undefined;

    const isLoading = !sessionsResult || (listParams.userId && !user);

    return {
      sessions: sessionsResult?.sessions,
      pagination: sessionsResult?.pagination,
      allStats,
      listParams,
      user,
      isLoading
    };
  } catch (error) {
    if (error instanceof AgentViewError) {
      throw data({ message: error.message, ...error.details }, { status: error.statusCode });
    }
    throw error;
  }
}

function Component() {
  const { sessions, pagination, listParams, allStats, user, isLoading } = useLoaderData<typeof loader>();
  const location = useLocation();

  const title = listParams.space === "production"
    ? "Sessions"
    : listParams.shared === true
      ? "Shared Playground"
      : listParams.shared === false
        ? "Private Playground"
        : "Playground";

  // For the chip: clicking the name drops /:id (and /runs/...) to show user props; X removes the user filter
  const userPageUrl = `/sessions${location.search}`;
  const removeFilterUrl = (() => {
    const params = new URLSearchParams(location.search);
    params.delete('userId');
    return `/sessions?${params.toString()}`;
  })();


  return <div className="flex flex-row items-stretch h-full">

    <div className="basis-[300px] flex-shrink-0 flex-grow-0 min-w-0 border-r flex flex-col ">

      <Header className="px-3">
        <HeaderTitle title={title} />
      </Header>


      {!isLoading && user && (
            <div className="flex items-center gap-1.5 text-sm px-3 py-2 border-b">
              <Link
                to={userPageUrl}
                className="text-cyan-700 hover:underline truncate"
              >
                {user.name || user.email || "Anonymous"}
              </Link>
              <Link
                to={removeFilterUrl}
                className="text-muted-foreground hover:text-foreground flex-shrink-0"
                aria-label="Remove user filter"
              >
                <X className="size-3.5" />
              </Link>
            </div>
          )}

      <div className="flex-1 overflow-y-auto pb-12">

        {isLoading && <div className="px-3 py-4 text-muted-foreground"><LoadingIndicator /></div>}

        {!isLoading && <>
          {sessions!.length === 0 && <div className="px-3 py-4 text-muted-foreground">No sessions available.</div>}
          {sessions!.length > 0 && (
            <>{sessions!.map(session => (
              <SessionCard
                key={session.id}
                session={session}
                listParams={listParams}
                sessionStats={allStats?.sessions?.[session.id]}
              />
            ))}</>
          )}

          {pagination && sessions!.length > 0 && <PaginationControls pagination={pagination} listParams={listParams} />}
        </>}

      </div>

    </div>

    <Outlet context={{ allStats: allStats ?? undefined, sessions, user }} />
  </div>
}

function PaginationControls({ pagination, listParams }: { pagination: Pagination, listParams: ListParams }) {
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



export function SessionCard({ session, listParams, sessionStats }: { session: SessionBase, listParams: ListParams, sessionStats: SessionStats | undefined }) {
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

  const playgroundOwner = session.user.space === 'playground'
    ? members.find((member) => member.userId === session.user.ownerId)
    : undefined;

  const userName = session.user.name || session.user.email || "Anonymous";
  const channelLabel = session.channel ? session.channel.address : "Web";

  return <div key={session.id}>
    <NavLink to={`/sessions/${session.id}?${toQueryParams(listParams)}`}>
      {({ isActive, isPending }) => (
        <div className={`p-3 border-b hover:bg-neutral-50 transition-colors duration-50 ${isActive ? 'bg-neutral-100' : ''}`}>
          <div className="flex flex-col">

            {/* Row 1: User + Time/Notifications */}
            <div className="flex flex-row gap-1 justify-between mb-1">
              <div className="flex flex-row gap-1.5 items-center min-w-0">
                {session.channel
                  ? <Mail className="size-3 flex-shrink-0 text-neutral-400" />
                  : <Globe className="size-3 flex-shrink-0 text-neutral-400" />
                }
                <span className={`truncate ${hasUnreads ? 'font-semibold' : 'font-medium'} text-sm`}>{userName}</span>
              </div>
              <div className="flex flex-row gap-1 items-center flex-shrink-0">
                <div className="text-xs text-neutral-500">{timeAgoShort(date)}</div>
                {itemsMentionsCount > 0 && <NotificationBadge>@</NotificationBadge>}
                {itemsMentionsCount === 0 && itemsEventsCount > 0 && <NotificationDot />}
              </div>
            </div>

            {/* Row 2: Title */}
            <div className={`truncate min-w-0 ${hasUnreads ? 'font-semibold' : 'font-normal'} text-sm mb-1.5`}>
              {session.title ?? "Untitled"}
            </div>

            {/* Row 3: Playground + Agent */}
            {(playgroundOwner || session.agent) && (
              <div className="flex flex-row gap-2 items-center text-neutral-500" style={{ fontSize: '12px' }}>
                {playgroundOwner && (
                  <UserAvatar image={playgroundOwner.user.image} size="sm" className="!size-3.5" />
                )}
                {session.agent && (
                  <span>{session.agent.name}@{session.agent.version}</span>
                )}
              </div>
            )}

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
