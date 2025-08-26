import React from 'react';
import { cn } from '../lib/utils';

interface PropertyListRootProps {
  children: React.ReactNode;
  className?: string;
}

interface PropertyListItemProps {
  children: React.ReactNode;
  className?: string;
}

interface PropertyListTitleProps {
  children: React.ReactNode;
  className?: string;
  width?: string;
}

interface PropertyListTextValueProps {
  children: React.ReactNode;
  className?: string;
  isMonospace?: boolean;
  isMuted?: boolean;
}

const PropertyListRoot: React.FC<PropertyListRootProps> = ({ children, className }) => {
  return (
    <div className={cn("grid grid-cols-1 gap-2", className)}>
      {children}
    </div>
  );
};

const PropertyListItem: React.FC<PropertyListItemProps> = ({ children, className }) => {
  return (
    <div className={cn("flex flex-row gap-4", className)}>
      {children}
    </div>
  );
};

const PropertyListTitle: React.FC<PropertyListTitleProps> = ({ 
  children, 
  className, 
  width = "w-32" 
}) => {
  return (
    <span className={cn("text-sm text-gray-700 w-[170px] flex-shrink-0 truncate", className)}>
      {children}
    </span>
  );
};

const PropertyListTextValue: React.FC<PropertyListTextValueProps> = ({ 
  children, 
  className, 
  isMonospace = false,
  isMuted = false
}) => {
  return (
    <span className={cn(
      "text-sm",
      isMonospace && "font-mono",
      isMuted && "text-gray-400",
      className
    )}>
      {children}
    </span>
  );
};

// Compound component structure
export const PropertyList = Object.assign(PropertyListRoot, {
  Root: PropertyListRoot,
  Item: PropertyListItem,
  Title: PropertyListTitle,
  TextValue: PropertyListTextValue,
});

export { PropertyListRoot, PropertyListItem, PropertyListTitle, PropertyListTextValue };
