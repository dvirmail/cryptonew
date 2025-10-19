import React from 'react';

// Context to share state between RadioGroup and RadioGroupItem
const RadioGroupContext = React.createContext(null);

const RadioGroup = React.forwardRef(
  ({ className, value, onValueChange, children, ...props }, ref) => {
    // Generate a unique name for the radio group to ensure they are linked correctly
    const name = React.useMemo(() => `radio-group-${Math.random().toString(36).substring(2, 9)}`, []);

    return (
      <RadioGroupContext.Provider value={{ name, selectedValue: value, onValueChange }}>
        <div
          ref={ref}
          className={`grid gap-2 ${className}`}
          {...props}
          role="radiogroup"
        >
          {children}
        </div>
      </RadioGroupContext.Provider>
    );
  }
);
RadioGroup.displayName = "RadioGroup";

const RadioGroupItem = React.forwardRef(({ className = "", value, ...props }, ref) => {
  const context = React.useContext(RadioGroupContext);

  if (!context) {
    throw new Error("RadioGroupItem must be used within a RadioGroup");
  }

  const { name, selectedValue, onValueChange } = context;

  return (
    <input
      type="radio"
      ref={ref}
      name={name}
      value={value}
      checked={selectedValue === value}
      onChange={(e) => {
        if (e.target.checked && onValueChange) {
          onValueChange(value);
        }
      }}
      className={`h-4 w-4 rounded-full border border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 ${className}`}
      {...props}
    />
  );
});
RadioGroupItem.displayName = "RadioGroupItem";

export { RadioGroup, RadioGroupItem };