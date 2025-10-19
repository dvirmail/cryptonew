import React from 'react';
import { cn } from '@/components/utils/utils';

export const TooltipProvider = ({ children }) => {
  return <div>{children}</div>;
};

export const Tooltip = ({ children, className = "" }) => {
  // Wrap trigger + content in a group so content can react to hover
  return <div className={cn("relative inline-block group", className)}>{children}</div>;
};

export const TooltipTrigger = React.forwardRef(({ children, asChild = false, ...props }, ref) => {
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children, { ...props, ref });
  }
  return <span {...props} ref={ref}>{children}</span>;
});
TooltipTrigger.displayName = "TooltipTrigger";

export const TooltipContent = React.forwardRef(({ 
  className, 
  sideOffset = 4,
  side = "top",
  align = "center",
  children,
  ...props 
}, ref) => {
  // Hidden by default; becomes visible only when parent .group is hovered
  return (
    <div
      ref={ref}
      className={cn(
        "absolute z-50 overflow-hidden rounded-md border bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 shadow-lg transition-all duration-150",
        // Hide by default
        "opacity-0 invisible pointer-events-none",
        // Show on hover of the Tooltip wrapper
        "group-hover:opacity-100 group-hover:visible group-hover:pointer-events-auto",
        // Positioning
        side === 'bottom' && "top-full mt-1",
        side === 'top' && "bottom-full mb-1", 
        side === 'left' && "right-full mr-1",
        side === 'right' && "left-full ml-1",
        align === 'center' && "left-1/2 -translate-x-1/2",
        align === 'start' && "left-0",
        align === 'end' && "right-0",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
});
TooltipContent.displayName = "TooltipContent";