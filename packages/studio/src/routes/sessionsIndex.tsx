import type { RouteObject } from "react-router";
import { useOutletContext } from "react-router";
import type { User } from "agentview/apiTypes";
import { Header, HeaderTitle } from "../components/header";
import { PropertyList, PropertyListItem, PropertyListTextValue, PropertyListTitle } from "../components/PropertyList";
import { useSessionContext } from "../lib/SessionContext";

function formatDateTime(value: string) {
  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function UserDisplayProperties({ user }: { user: User }) {
  const { organization: { members } } = useSessionContext();
  const owner = user.ownerId ? members.find((m) => m.userId === user.ownerId) : undefined;

  const spaceLabel = user.space === 'production'
    ? 'Production'
    : user.shared
      ? 'Shared playground'
      : 'Private playground';

  return (
    <PropertyList>
      <PropertyListItem>
        <PropertyListTitle>ID</PropertyListTitle>
        <PropertyListTextValue isMonospace>{user.id}</PropertyListTextValue>
      </PropertyListItem>
      <PropertyListItem>
        <PropertyListTitle>External ID</PropertyListTitle>
        <PropertyListTextValue isMonospace isMuted={!user.externalId}>
          {user.externalId ?? '—'}
        </PropertyListTextValue>
      </PropertyListItem>
      <PropertyListItem>
        <PropertyListTitle>Name</PropertyListTitle>
        <PropertyListTextValue isMuted={!user.name}>{user.name ?? '—'}</PropertyListTextValue>
      </PropertyListItem>
      <PropertyListItem>
        <PropertyListTitle>Email</PropertyListTitle>
        <PropertyListTextValue isMuted={!user.email}>{user.email ?? '—'}</PropertyListTextValue>
      </PropertyListItem>
      <PropertyListItem>
        <PropertyListTitle>Headline</PropertyListTitle>
        <PropertyListTextValue isMuted={!user.headline}>{user.headline ?? '—'}</PropertyListTextValue>
      </PropertyListItem>
      <PropertyListItem>
        <PropertyListTitle>Details</PropertyListTitle>
        <PropertyListTextValue isMuted={!user.details}>
          {user.details ?? '—'}
        </PropertyListTextValue>
      </PropertyListItem>
      <PropertyListItem>
        <PropertyListTitle>Space</PropertyListTitle>
        <PropertyListTextValue>
          {spaceLabel}
          {owner && <> · <span className="text-cyan-700">{owner.user.name}</span></>}
        </PropertyListTextValue>
      </PropertyListItem>
      <PropertyListItem>
        <PropertyListTitle>Created</PropertyListTitle>
        <PropertyListTextValue>{formatDateTime(user.createdAt)}</PropertyListTextValue>
      </PropertyListItem>
      <PropertyListItem>
        <PropertyListTitle>Updated</PropertyListTitle>
        <PropertyListTextValue>{formatDateTime(user.updatedAt)}</PropertyListTextValue>
      </PropertyListItem>
    </PropertyList>
  );
}

function Component() {
  const { user } = useOutletContext<{ user?: User }>() ?? {};

  if (!user) return null;

  const title = user.name || user.email || "Anonymous";

  return (
    <div className="flex-grow-1 border-r flex flex-col">
      <Header>
        <HeaderTitle title={title} />
      </Header>
      <div className="flex-1 overflow-y-auto">
        <div className="p-6">
          <UserDisplayProperties user={user} />
        </div>
      </div>
    </div>
  );
}

export const sessionsIndexRoute: RouteObject = {
  Component,
}
