import React from "react";

export const badgeVariants = {
  default: "bg-blue-600 text-white hover:bg-blue-700",
  secondary: "bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-600",
  destructive: "bg-red-600 text-white hover:bg-red-700",
  outline: "border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800",
  success: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  live: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300"
};

export const Badge = React.forwardRef(({ 
  className = "", 
  variant = "default", 
  ...props 
}, ref) => {
  const baseClasses = "inline-flex items-center rounded-md px-2 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2";
  const variantClasses = badgeVariants[variant] || badgeVariants.default;
  
  return (
    <div
      className={`${baseClasses} ${variantClasses} ${className}`}
      ref={ref}
      {...props}
    />
  );
});

Badge.displayName = "Badge";