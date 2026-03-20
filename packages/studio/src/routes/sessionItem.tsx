import { data, useLoaderData, useOutletContext, useParams, useRevalidator } from "react-router";
import type { RouteObject } from "react-router";
import { Header, HeaderTitle } from "../components/header";
import type { StandardSession, SessionsStats } from "agentview/apiTypes";
import { getAllSessionItems } from "agentview/sessionUtils";
import { CommentsThreadRaw } from "../components/internal/comments";
import { agentview } from "../lib/agentview";
import { useEffect } from "react";

function Component() {
    return null;
    // const { session, allStats } = useOutletContext<{ session: Session, allStats?: SessionsStats }>();
    // const params = useParams();
    // const revalidator = useRevalidator();

    // const items = getAllSessionItems(session)
    // const item = items.find((a) => a.id === params.itemId)

    // if (!item) {
    //     throw data({ message: "Item not found" }, { status: 404 })
    // }

    // useEffect(() => {
    //     const itemStats = allStats?.sessions?.[session.id]?.items?.[item.id];
    //     // Skip if stats available and no unreads
    //     if (allStats && !itemStats?.unseenEvents?.length) return;

    //     agentview.markItemSeen(session.id, item.id)
    //         .then(() => revalidator.revalidate())
    //         .catch((error) => console.error(error))
    // }, [item.id]) // make sure /seen is called when switching sessions

    // return <div className="flex-1  flex flex-col">
    //     <Header>
    //         <HeaderTitle title={`Session Item`} />
    //     </Header>
    //     <div className="flex-1 overflow-y-auto">
    //         <CommentsThreadRaw
    //             item={item}
    //             session={session}
    //             collapsed={false}
    //             singleLineMessageHeader={true}
    //         />

    //     </div>
    // </div>
}

export const sessionItemRoute: RouteObject = {
  Component,
}
