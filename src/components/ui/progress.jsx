import React from 'react';
import { cn } from '@/components/utils/utils';

export const Progress = React.forwardRef(({ className, value, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("relative h-4 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700", className)}
    {...props}
  >
    <div
      className="h-full w-full flex-1 bg-blue-600 dark:bg-blue-500 transition-all"
      style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
    />
  </div>
));
Progress.displayName = 'Progress';