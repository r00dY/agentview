import { data, useFetcher, useLoaderData, useActionData, useRevalidator } from "react-router";
import { useEffect } from "react";
import type { Route } from "./+types/inbox";

import { Header, HeaderTitle } from "~/components/header";
import { apiFetch } from "~/lib/apiFetch";
import type { InboxItem } from "~/lib/shared/apiTypes";
import { timeAgoShort } from "~/lib/timeAgo";
import { authClient } from "~/lib/auth-client";
import { MessageCircle } from "lucide-react";
import { Button } from "~/components/ui/button";

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const response = await apiFetch<InboxItem[]>(`/api/inbox`);
  const session = await authClient.getSession()

  if (!response.ok) {
    throw data(response.error, { status: response.status });
  }

  return { inboxItems: response.data };
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData();
  const action = formData.get("action");
  
  if (action === "markAsRead") {
    const inboxItemId = formData.get("inboxItemId") as string;
    
    if (!inboxItemId) {
      throw new Error("Inbox item ID is required");
    }

    const response = await apiFetch(`/api/inbox/${inboxItemId}/mark_as_read`, {
      method: "POST",
    });

    if (!response.ok) {
      throw new Error("Failed to mark item as read");
    }

    return { success: true };
  }

  throw new Error("Invalid action");
}

// Separate InboxItem component
function InboxItemComponent({ item }: { item: InboxItem }) {
  const fetcher = useFetcher();
  const isRead = item.lastReadEventId >= item.lastNotifiableEventId;

  return (
    <div className="p-3 border-b flex flex-col gap-2">
      <div className="flex flex-row gap-2 justify-stretch">
        <div className="text-sm">
          Some new activities in
          {/* <span className="font-medium">{author.name}</span> commented in{" "} */}
          <div className="inline-flex font-medium flex-row items-center gap-1">
            <MessageCircle className="size-4" /> Session {item.thread.number} (item {item.activity.number})
          </div>
        </div>
        <div className="flex flex-row gap-1">
          <div className="text-sm text-gray-500">{timeAgoShort(item.updatedAt)}</div>
          <div className="text-sm text-gray-500">{isRead ? "" : `(${item.render.items.length})`}</div>
        </div>
      </div>
      
      {/* Mark as read button for unread items */}
      {!isRead && !fetcher.data?.success && (
        <fetcher.Form method="post" className="mt-2">
          <input type="hidden" name="action" value="markAsRead" />
          <input type="hidden" name="inboxItemId" value={item.id} />
          
          {/* Error message */}
          {fetcher.data?.ok === false && fetcher.state === 'idle' && (
            <div className="text-sm text-red-600 mb-2">
              Failed to mark as read. Please try again.
            </div>
          )}
          
          <Button 
            type="submit" 
            variant="outline" 
            size="sm"
            disabled={fetcher.state !== "idle"}
            className="w-full"
          >
            {fetcher.state === "submitting" ? "Marking..." : 
              fetcher.state === "loading" ? "Marked!" : "Mark as Read"}
          </Button>
        </fetcher.Form>
      )}
      
      {/* Success message when marked as read */}
      {/* {fetcher.data?.success && fetcher.state === 'idle' && (
        <div className="text-sm text-green-600 mt-2 font-medium">
          ✓ Marked as read
        </div>
      )} */}
    </div>
  );
}

export default function InboxPage() {
  const { inboxItems } = useLoaderData<typeof clientLoader>();
  console.log(inboxItems);

  // return <div>gowno</div>

  return (
    <div className="flex flex-row items-stretch h-full">
      <div className="basis-[335px] flex-shrink-0 flex-grow-0 border-r flex flex-col">
        <Header className="px-3">
          <HeaderTitle title="Inbox" />
        </Header>

        <div>
          {inboxItems.map((item) => (
            <InboxItemComponent key={item.id} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
} 