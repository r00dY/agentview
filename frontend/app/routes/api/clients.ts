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

  // Validate that there are no parameters
  const url = new URL(request.url);
  if (url.searchParams.toString()) {
    return { error: "POST request should not contain any parameters" };
  }

  try {
    // Create a new client in the database
    await db.insert(clients).values({});
    
    // Since we can't return the inserted record easily without returning(),
    // we'll return a success message
    return { success: true, message: "Client created successfully" };
  } catch (error) {
    console.error("Error creating client:", error);
    return { error: "Failed to create client" };
  }
}