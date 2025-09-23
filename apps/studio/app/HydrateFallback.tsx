export function HydrateFallback() {
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