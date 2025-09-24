import { data, useLoaderData, useOutletContext, useParams, useRevalidator } from "react-router";
import type { RouteObject } from "react-router";
import { Header, HeaderTitle } from "~/components/header";
import type { Session } from "~/lib/shared/apiTypes";
import { getAllSessionItems } from "~/lib/shared/sessionUtils";
import { CommentThread } from "~/components/comments";
import { apiFetch } from "~/lib/apiFetch";
import { useEffect } from "react";

function Component() {
    const { session } = useOutletContext<{ session: Session }>();
    const params = useParams();
    const revalidator = useRevalidator();

    const items = getAllSessionItems(session)
    const item = items.find((a) => a.id === params.itemId)

    if (!item) {
        throw data({ message: "Item not found" }, { status: 404 })
    }

    useEffect(() => {
        apiFetch(`/api/sessions/${session.id}/items/${item.id}/seen`, {
            method: 'POST',
        }).then((data) => {
            if (data.ok) {
                revalidator.revalidate();
            }
            else {
                console.error(data.error)
            }
        })
    }, [item.id]) // make sure /seen is called when switching sessions

    return <div className="flex-1  flex flex-col">
        <Header>
            <HeaderTitle title={`Item ${item.number}`} />
        </Header>
        <div className="flex-1 overflow-y-auto">
            <CommentThread
                item={item}
                session={session}
                collapsed={false}
                singleLineMessageHeader={true}
            />

        </div>
    </div>
}

export const sessionItemRoute: RouteObject = {
  Component,
}
