import { data, useFetcher, useLoaderData } from "react-router";
import type { Route } from "./+types/inbox";

import { Header, HeaderTitle } from "~/components/header";
import { apiFetch } from "~/lib/apiFetch";
import type { InboxItem } from "~/lib/shared/apiTypes";
import { timeAgoShort } from "~/lib/timeAgo";

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const response = await apiFetch<InboxItem[]>(`/api/inbox`);

  if (!response.ok) {
    throw data(response.error, { status: response.status });
  }

  return { inboxItems: response.data };
}

export default function InboxPage() {
  const { inboxItems } = useLoaderData<typeof clientLoader>();
  console.log(inboxItems);
  // const fetcher = useFetcher();

  return <div className="flex flex-row items-stretch h-full">


    <div className="basis-[335px] flex-shrink-0 flex-grow-0 border-r flex flex-col ">

      <Header className="px-3">
        <HeaderTitle title="Inbox" />
      </Header>

      <div>
        { inboxItems.map((item) => (
          <div key={item.id} className="p-3 border-b flex flex-col gap-2">
            <div className="text-sm font-medium">{item.activityId}</div>
            <div className="text-sm text-gray-500">{timeAgoShort(item.updatedAt)}</div>
          </div>
        ))  }
      </div>
    </div>
  </div>

} 