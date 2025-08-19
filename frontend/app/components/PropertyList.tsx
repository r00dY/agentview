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
    <span className={cn("text-sm font-medium text-muted-foreground", width, className)}>
      {children}
    </span>
  );
};

const PropertyListTextValue: React.FC<PropertyListTextValueProps> = ({ 
  children, 
  className, 
  isMonospace = false 
}) => {
  return (
    <span className={cn(
      "text-sm",
      isMonospace && "font-mono",
      className
    )}>
      {children}
    </span>
  );
};

// Compound component structure
const PropertyList = Object.assign(PropertyListRoot, {
  Root: PropertyListRoot,
  Item: PropertyListItem,
  Title: PropertyListTitle,
  TextValue: PropertyListTextValue,
});

export default PropertyList;
export { PropertyListRoot, PropertyListItem, PropertyListTitle, PropertyListTextValue };
