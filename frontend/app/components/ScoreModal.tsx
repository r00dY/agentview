import { useState } from "react";
import { useFetcher } from "react-router";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "~/components/ui/dialog";
import { Textarea } from "~/components/ui/textarea";
import { Label } from "~/components/ui/label";
import { Badge } from "~/components/ui/badge";
import { config } from "~/agentview.config";
import { useFetcherSuccess } from "~/hooks/useFetcherSuccess";
import type { Activity, Thread, Score } from "~/apiTypes";

interface ScoreModalProps {
    activity: Activity;
    thread: Thread;
    trigger: React.ReactNode;
}

export function ScoreModal({ activity, thread, trigger }: ScoreModalProps) {
    const [open, setOpen] = useState(false);
    const fetcher = useFetcher();
    const [scoreValues, setScoreValues] = useState<Record<string, string>>({});

    useFetcherSuccess(fetcher, () => {
        setOpen(false);
        setScoreValues({});
    });

    // Find thread configuration to get available scores
    const threadConfig = config.threads.find((t: any) => t.type === thread.type);
    const activityConfig = threadConfig?.activities.find((a: any) => 
        a.type === activity.type && a.role === activity.role
    );
    const availableScores = activityConfig?.scores || [];

    // Create a map of existing scores by name
    const existingScores = activity.scores.reduce((acc: Record<string, Score>, score: Score) => {
        acc[score.name] = score;
        return acc;
    }, {});

    const handleScoreChange = (scoreName: string, value: string) => {
        setScoreValues(prev => ({
            ...prev,
            [scoreName]: value
        }));
    };

    const handleSubmit = async () => {
        // Submit each new score
        for (const [scoreName, value] of Object.entries(scoreValues)) {
            if (value && !existingScores[scoreName]) {
                try {
                    // Parse the JSON value
                    let parsedValue;
                    try {
                        parsedValue = JSON.parse(value);
                    } catch (error) {
                        console.error('Invalid JSON value:', value);
                        continue;
                    }

                    // Create the score
                    const response = await fetch('/api/scores', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            activityId: activity.id,
                            name: scoreName,
                            value: parsedValue,
                            commentId: null,
                        })
                    });

                    if (!response.ok) {
                        console.error('Failed to create score:', await response.text());
                    }
                } catch (error) {
                    console.error('Error creating score:', error);
                }
            }
        }
        
        // Close modal and reset
        setOpen(false);
        setScoreValues({});
    };

    const hasNewScores = Object.keys(scoreValues).length > 0;

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger}
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Activity Scores</DialogTitle>
                </DialogHeader>
                
                <div className="space-y-4">
                    {availableScores.map((scoreConfig: any) => {
                        const existingScore = existingScores[scoreConfig.name];
                        const isNew = !existingScore && scoreValues[scoreConfig.name];
                        
                        return (
                            <div key={scoreConfig.name} className="border rounded-lg p-4 space-y-3">
                                <div className="flex items-center gap-2">
                                    <Label className="font-medium">{scoreConfig.title || scoreConfig.name}</Label>
                                    {existingScore && <Badge variant="secondary">Applied</Badge>}
                                    {isNew && <Badge variant="outline">New</Badge>}
                                </div>
                                
                                {existingScore ? (
                                    <div>
                                        <Label>Value:</Label>
                                        <pre className="mt-1 p-2 bg-gray-100 rounded text-sm overflow-auto">
                                            {JSON.stringify(existingScore.value, null, 2)}
                                        </pre>
                                    </div>
                                ) : (
                                    <div>
                                        <Label htmlFor={`score-${scoreConfig.name}`}>Value (JSON)</Label>
                                        <Textarea
                                            id={`score-${scoreConfig.name}`}
                                            value={scoreValues[scoreConfig.name] || ""}
                                            onChange={(e) => handleScoreChange(scoreConfig.name, e.target.value)}
                                            placeholder="Enter JSON value..."
                                            className="mt-1"
                                        />
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {availableScores.length === 0 && (
                        <div className="text-center text-gray-500 py-4">
                            No scores available for this activity type.
                        </div>
                    )}

                    <div className="flex gap-2">
                        <Button
                            type="button"
                            onClick={handleSubmit}
                            disabled={!hasNewScores || fetcher.state !== 'idle'}
                            className="flex-1"
                        >
                            {fetcher.state !== 'idle' ? 'Saving...' : 'Save Scores'}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setOpen(false)}
                            className="flex-1"
                        >
                            Cancel
                        </Button>
                    </div>

                    {fetcher.data?.error && (
                        <div className="text-sm text-red-500">{fetcher.data.error}</div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
} 