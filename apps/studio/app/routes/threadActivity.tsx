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
    // const { user, members } = useSessionContext();

    const activities = getAllActivities(thread)
    const activity = activities.find((a) => a.id === params.activityId)

    if (!activity) {
        throw data({ message: "Activity not found" }, { status: 404 })
    }

    // // Find thread configuration to get available scores
    // const threadConfig = config.threads.find((t: any) => t.type === thread.type);
    // const activityConfig = threadConfig?.activities.find((a: any) => 
    //     a.type === activity.type && a.role === activity.role
    // );
    // const availableScores = activityConfig?.scores || [];

    // // Filter scores to only show current user's scores
    // const userScores = activity.scores.filter((score: any) => 
    //     score.createdBy === user?.id && !score.deletedAt
    // );

    // // Create a map of user scores by name for easy lookup
    // const userScoresMap = userScores.reduce((acc: Record<string, any>, score: any) => {
    //     acc[score.name] = score;
    //     return acc;
    // }, {});

    useEffect(() => {
        apiFetch(`/api/threads/${thread.id}/activities/${activity.id}/seen`, {
            method: 'POST',
        }).then((data) => {
            if (data.ok) {
                revalidator.revalidate();
            }
            else {
                console.error(data.error)
            }
        })
    }, [])          

    return  <div className="flex-1  flex flex-col">  
        <Header>
            <HeaderTitle title={`Activity ${activity.number}`} />
        </Header>
        <div className="flex-1 overflow-y-auto">

            {/* <div className=" p-6 max-w-4xl space-y-6"> */}
                    {/* <div>
                        <h3 className="text-sm font-medium mb-2 text-gray-700">Scores</h3>

                        { availableScores.length === 0 && <div className="text-muted-foreground text-sm">No scores available</div> }

                        { availableScores.length > 0 && <PropertyList>
                            {availableScores.map((scoreConfig: any) => {
                                const userScore = userScoresMap[scoreConfig.name];
                                const scoreTitle = scoreConfig.title || scoreConfig.name;
                                const scoreValue = userScore ? JSON.stringify(userScore.value) : "Empty";
                                
                                return (
                                    <PropertyList.Item key={scoreConfig.name}>
                                        <PropertyList.Title>{scoreTitle}</PropertyList.Title>
                                        <PropertyList.TextValue isMonospace={false} isMuted={scoreValue === "Empty"}>
                                            {scoreValue}
                                        </PropertyList.TextValue>
                                    </PropertyList.Item>
                                );
                            })}
                        </PropertyList> }
                    </div>
 */}

                    {/* <div className="mt-8">
                        <h3 className="text-sm font-medium mb-4 text-gray-700">Discussion</h3> */}

                        {/* { activity.commentMessages.length === 0 && <div className="text-muted-foreground text-sm">No discussion available</div> } */}

                        <div><CommentThread
                            activity={activity}
                            // user={user}
                            // users={members}
                            thread={thread}
                            collapsed={false}
                            singleLineMessageHeader={true}
                        /></div>
                    {/* </div> */}


            {/* </div> */}

        </div>
    </div>
}
