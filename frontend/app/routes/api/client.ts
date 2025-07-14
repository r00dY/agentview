import { data } from "react-router";
import type { Route } from "./+types/client";
import { db } from "../../../lib/db.server";
import { clients } from "../../../db/schema";
import { eq } from "drizzle-orm";

export async function loader({ params, request }: Route.LoaderArgs) {
  const client = await db.query.clients.findFirst({
    where: eq(clients.id, params.id),
  });

  if (!client) {
    return data({ error: "Client not found" }, { status: 404 });
  }

  return data({
    data: client,
  }, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  })
}

