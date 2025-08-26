// import { redirect} from "react-router";
// import { db } from "~/lib/db.server";
import type { Route } from "./+types/threadsIndex";
// import { getThreadTypes } from "~/lib/utils";

export async function clientLoader({request}: Route.ClientLoaderArgs) {
  // const type =  getThreadTypes(request);

  // const threadRows = await db.query.thread.findMany({
  //   with: {
  //     activities: true
  //   },
  //   orderBy: (thread, { desc }) => [desc(thread.updated_at)],
  //   limit: 1
  // })

  // if (threadRows[0]?.id) {
  //   return redirect(`/threads/${threadRows[0].id}`)
  // }
  // else {
  //   if (type !== "real") {
  //     return redirect('/threads/new')
  //   }
  //   else {
  //     return redirect('/threads')
  //   }
  // }
}

export default function ThreadsIndex() {
  return null;
}