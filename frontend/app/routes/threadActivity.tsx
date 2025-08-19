import { data, useLoaderData, useOutletContext, useParams } from "react-router";
import type { Route } from "./+types/threadActivity";
import { Header, HeaderTitle } from "~/components/header";
import type { Thread } from "~/apiTypes";
import { getAllActivities } from "~/lib/threadUtils";

export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {

}

export default function ThreadActivityPage() {
    const { thread } = useOutletContext<{ thread: Thread }>();
    const params = useParams();

    const activities = getAllActivities(thread)
    const activity = activities.find((a) => a.id === params.activityId)

    if (!activity) {
        throw data({ message: "Activity not found" }, { status: 404 })
    }
    
    return  <div className="flex-1  flex flex-col">  
        <Header>
            <HeaderTitle title={`Activity`} />
        </Header>
        <div className="flex-1 overflow-y-auto">

            <div className=" p-6 max-w-4xl space-y-6">
                Hello Activity {activity.id}
            </div>

        </div>
    </div>
}
