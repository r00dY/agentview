import type { ReactNode } from "react";

interface HeaderProps {
  children: ReactNode;
  className?: string;
}

export function Header({ children, className = "" }: HeaderProps) {
  return (
    <div className={`py-3 px-6 border-b flex items-center justify-between min-h-[56px] ${className}`}>
      {children}
    </div>
  );
}

interface HeaderTitleProps {
  title: string;
  subtitle?: string;
}

export function HeaderTitle({ title, subtitle }: HeaderTitleProps) {
  return (
    <>
      <div>
        <h1 className="text-lg font-medium leading-none">{title}</h1>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
        )}
      </div>
    </>
  );
}
