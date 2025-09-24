import { isRouteErrorResponse, Outlet, useRouteError, type IndexRouteObject, type NonIndexRouteObject, type RouteObject } from "react-router";

function Component() {
  return <Outlet />
}

function ErrorBoundary() {
  const error = useRouteError();
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;
  let data: any;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;

    data = error.data;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      { data && (<div>
          <br/>
          <pre>{JSON.stringify(data, null, 2)}</pre>
        </div>
      )}
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}

function HydrateFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <img
        src="/logo.svg"
        alt="AgentView Logo"
        className="w-48 h-48"
        style={{ objectFit: "contain" }}
      />
    </div>
  );
}

export const rootRoute : NonIndexRouteObject = {
  Component,
  ErrorBoundary,
  HydrateFallback,
}