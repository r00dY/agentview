import { data } from "react-router";
import type { Route } from "./+types/client";

export async function loader({ params }: Route.LoaderArgs) {
    return data({
        id: params.id
    }, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
      },
    })
  }