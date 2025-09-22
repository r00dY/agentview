import { data, useLoaderData, useOutletContext, useParams, useRevalidator } from "react-router";
import type { Route } from "./+types/threadActivity";
import { Header, HeaderTitle } from "~/components/header";
import type { Thread } from "~/lib/shared/apiTypes";
import { getAllActivities } from "~/lib/shared/threadUtils";
import { authClient } from "~/lib/auth-client";
import { CommentThread } from "~/components/comments";
import { apiFetch } from "~/lib/apiFetch";
import { useSessionContext } from "~/lib/session";
import { useEffect } from "react";

export default function ThreadActivityPage() {
    const { thread } = useOutletContext<{ thread: Thread }>();
    const params = useParams();
    const revalidator = useRevalidator();

    const activities = getAllActivities(thread)
    const activity = activities.find((a) => a.id === params.activityId)

    if (!activity) {
        throw data({ message: "Activity not found" }, { status: 404 })
    }

    useEffect(() => {
        apiFetch(`/api/sessions/${thread.id}/items/${activity.id}/seen`, {
            method: 'POST',
        }).then((data) => {
            if (data.ok) {
                revalidator.revalidate();
            }
            else {
                console.error(data.error)
            }
        })
    }, [activity.id]) // make sure /seen is called when switching activities

    return <div className="flex-1  flex flex-col">
        <Header>
            <HeaderTitle title={`Activity ${activity.number}`} />
        </Header>
        <div className="flex-1 overflow-y-auto">
            <CommentThread
                activity={activity}
                thread={thread}
                collapsed={false}
                singleLineMessageHeader={true}
            />

        </div>
    </div>
}
