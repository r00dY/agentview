import { data, useLoaderData, useOutletContext, useParams } from "react-router";
import type { Route } from "./+types/threadActivity";
import { Header, HeaderTitle } from "~/components/header";
import type { Thread } from "~/apiTypes";
import { getAllActivities } from "~/lib/threadUtils";
import { PropertyList } from "~/components/PropertyList";
import { config } from "~/agentview.config";
import { authClient } from "~/lib/auth-client";
import { CommentThread } from "~/components/comments";
import { apiFetch } from "~/lib/apiFetch";

export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
    const session = await authClient.getSession();

    const usersResponse = await apiFetch('/api/members');

    if (!usersResponse.ok) {
        throw data(usersResponse.error, {
            status: usersResponse.status,
        });
    }

    
    return {
        user: session.data!.user,
        users: usersResponse.data
    };
}

export default function ThreadActivityPage() {
    const { thread } = useOutletContext<{ thread: Thread }>();
    const params = useParams();
    const { user, users } = useLoaderData<typeof clientLoader>();

    const activities = getAllActivities(thread)
    const activity = activities.find((a) => a.id === params.activityId)

    if (!activity) {
        throw data({ message: "Activity not found" }, { status: 404 })
    }

    // Find thread configuration to get available scores
    const threadConfig = config.threads.find((t: any) => t.type === thread.type);
    const activityConfig = threadConfig?.activities.find((a: any) => 
        a.type === activity.type && a.role === activity.role
    );
    const availableScores = activityConfig?.scores || [];

    // Filter scores to only show current user's scores
    const userScores = activity.scores.filter((score: any) => 
        score.createdBy === user?.id && !score.deletedAt
    );

    // Create a map of user scores by name for easy lookup
    const userScoresMap = userScores.reduce((acc: Record<string, any>, score: any) => {
        acc[score.name] = score;
        return acc;
    }, {});

    return  <div className="flex-1  flex flex-col">  
        <Header>
            <HeaderTitle title={`Activity`} />
        </Header>
        <div className="flex-1 overflow-y-auto">

            <div className=" p-6 max-w-4xl space-y-6">
                    <div>
                        <h3 className="text-sm font-medium mb-2 text-muted-foreground">Scores</h3>

                        { availableScores.length === 0 && <div className="text-muted-foreground text-sm">No scores available</div> }

                        { availableScores.length > 0 && <PropertyList>
                            {availableScores.map((scoreConfig: any) => {
                                const userScore = userScoresMap[scoreConfig.name];
                                const scoreTitle = scoreConfig.title || scoreConfig.name;
                                const scoreValue = userScore ? JSON.stringify(userScore.value) : "empty";
                                
                                return (
                                    <PropertyList.Item key={scoreConfig.name}>
                                        <PropertyList.Title>{scoreTitle}</PropertyList.Title>
                                        <PropertyList.TextValue isMonospace={true} isMuted={scoreValue === "empty"}>
                                            {scoreValue}
                                        </PropertyList.TextValue>
                                    </PropertyList.Item>
                                );
                            })}
                        </PropertyList> }
                    </div>


                    <div className="mt-8">
                        <h3 className="text-sm font-medium mb-4 text-muted-foreground">Discussion</h3>

                        { activity.commentMessages.length === 0 && <div className="text-muted-foreground text-sm">No discussion available</div> }

                        { activity.commentMessages.length > 0 && <CommentThread
                            activity={activity}
                            user={user}
                            users={users}
                            thread={thread}
                            collapsed={false}
                        /> }
                    </div>


            </div>

        </div>
    </div>
}
