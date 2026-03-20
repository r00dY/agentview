import type { StandardRun } from "agentview/apiTypes"
import { agentview } from "./agentview";
import { toast } from "sonner";

export async function debugRun(run: StandardRun) {
    // toast.info("Check console for error details.")

    // try {
    //     const result = await agentview.getRunDetails(run.sessionId, run.id);

    //     console.log({
    //         ...run,
    //         request: result?.request,
    //         response: result?.response,
    //     })
    // } catch (error) {
    //     console.error("Failed to get run details");
    //     console.error(error);
    // }
}
