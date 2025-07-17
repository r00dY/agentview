import { redirect} from "react-router";
import { db } from "~/lib/db.server";


export async function loader() {
  const threadRows = await db.query.thread.findMany({
    with: {
      activities: true
    },
    orderBy: (thread, { desc }) => [desc(thread.updated_at)]
  })

  return redirect(`/threads/${threadRows[0].id}`)
}

