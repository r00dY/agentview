import { cn } from "~/lib/utils"

export function NotificationBadge({ children, className = "" }: { children: React.ReactNode, className?: string }) {
  return (
    <div className={cn("flex items-center justify-center rounded-full bg-cyan-600 text-white text-xs font-semibold size-5", className)}>
      {children}
    </div>
  );
}