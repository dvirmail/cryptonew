import React, { useState, createContext, useContext } from 'react';
import { ChevronDown, Check } from 'lucide-react';

const SelectContext = createContext(null);

export const Select = ({ children, value, onValueChange, defaultValue, ...props }) => {
  const [internalValue, setInternalValue] = useState(defaultValue || '');
  const [isOpen, setIsOpen] = useState(false);
  
  const isControlled = value !== undefined;
  const currentValue = isControlled ? value : internalValue;
  
  const setValue = (newValue) => {
    if (isControlled) {
      onValueChange?.(newValue);
    } else {
      setInternalValue(newValue);
      onValueChange?.(newValue);
    }
    setIsOpen(false);
  };

  const contextValue = {
    value: currentValue,
    setValue,
    isOpen,
    setIsOpen
  };

  return (
    <SelectContext.Provider value={contextValue}>
      <div className="relative" {...props}>
        {children}
      </div>
    </SelectContext.Provider>
  );
};

export const SelectTrigger = React.forwardRef(({ className = "", children, ...props }, ref) => {
  const context = useContext(SelectContext);
  if (!context) throw new Error("SelectTrigger must be used within a Select component");

  return (
    <button
      ref={ref}
      type="button"
      className={`flex h-9 w-full items-center justify-between rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm shadow-sm placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:focus:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      onClick={() => context.setIsOpen(!context.isOpen)}
      {...props}
    >
      {children}
      <ChevronDown className="h-4 w-4 opacity-50" />
    </button>
  );
});

SelectTrigger.displayName = "SelectTrigger";

export const SelectValue = ({ placeholder = "Select..." }) => {
  const context = useContext(SelectContext);
  if (!context) throw new Error("SelectValue must be used within a Select component");

  return (
    <span className="truncate">
      {context.value || placeholder}
    </span>
  );
};

export const SelectContent = ({ className = "", children, ...props }) => {
  const context = useContext(SelectContext);
  if (!context) throw new Error("SelectContent must be used within a Select component");

  if (!context.isOpen) return null;

  return (
    <div
      className={`absolute top-full left-0 z-50 w-full min-w-[8rem] overflow-hidden rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-950 dark:text-gray-50 shadow-md animate-in fade-in-0 zoom-in-95 ${className}`}
      {...props}
    >
      <div className="max-h-60 overflow-auto p-1">
        {children}
      </div>
    </div>
  );
};

export const SelectItem = React.forwardRef(({ className = "", children, value, ...props }, ref) => {
  const context = useContext(SelectContext);
  if (!context) throw new Error("SelectItem must be used within a Select component");

  const isSelected = context.value === value;

  return (
    <div
      ref={ref}
      className={`relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none hover:bg-gray-100 dark:hover:bg-gray-700 focus:bg-gray-100 dark:focus:bg-gray-700 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 ${className}`}
      onClick={() => context.setValue(value)}
      {...props}
    >
      {children}
      {isSelected && (
        <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
          <Check className="h-4 w-4" />
        </span>
      )}
    </div>
  );
});

SelectItem.displayName = "SelectItem";