import { data } from "react-router";
import type { Route } from "./+types/clients";
import { db } from "../../../lib/db.server";
import { clients } from "../../../db/schema";

export async function loader({ params, request }: Route.LoaderArgs) {
  // Only allow POST method
  if (request.method !== "POST") {
    throw new Response("Method not allowed", { status: 405 });
  }
  
  return data([], {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  })
}

export async function action({ request }: Route.ActionArgs) {
  // Only allow POST method
  if (request.method !== "POST") {
    throw new Response("Method not allowed", { status: 405 });
  }

  try {
    // Create a new client in the database
    const [newClient] = await db.insert(clients).values({}).returning();
    
    // Since we can't return the inserted record easily without returning(),
    // we'll return a success message
    return data(newClient, {
      status: 201
    });

  } catch (error) {
    return data({ error: "Failed to create client" }, { status: 500 });
  }
}