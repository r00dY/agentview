

export function ScoreBadge({ score }: { score: string }) {
    const getScoreStyles = (score: string) => {
        switch (score) {
            case "best_fit":
                return "bg-green-900 text-white"; // Dark green
            case "great_option":
                return "bg-green-600 text-white"; // Green
            case "optional":
                return "bg-yellow-500 text-white"; // Yellow
            case "not_recommended":
                return "bg-red-500 text-white"; // Red
            default:
                return "bg-gray-500 text-white";
        }
    };

    const getScoreLabel = (score: string) => {
        switch (score) {
            case "best_fit":
                return "Best Fit";
            case "great_option":
                return "Great Option";
            case "optional":
                return "Optional";
            case "not_recommended":
                return "Not Recommended";
            default:
                return score;
        }
    };

    return (
        <span className={`inline-flex items-center justify-center rounded-md px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 ${getScoreStyles(score)}`}>
            {getScoreLabel(score)}
        </span>
    );
}