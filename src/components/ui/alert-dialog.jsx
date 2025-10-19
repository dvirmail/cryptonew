import React, { useState, createContext, useContext } from 'react';
import { Button } from '@/components/ui/button';

// Create a context to share dialog state
const AlertDialogContext = createContext(null);

export function AlertDialog({ children, open, onOpenChange, ...props }) {
  const [isOpen, setIsOpen] = useState(open || false);

  // Allow the dialog to be controlled from outside
  React.useEffect(() => {
    if (open !== undefined) {
      setIsOpen(open);
    }
  }, [open]);

  const handleOpenChange = React.useCallback((newOpen) => {
    if (onOpenChange) {
      onOpenChange(newOpen);
    } else {
      setIsOpen(newOpen);
    }
  }, [onOpenChange]);

  const contextValue = React.useMemo(() => ({
    isOpen,
    setIsOpen: handleOpenChange
  }), [isOpen, handleOpenChange]);

  // Find the Trigger and Content from children
  const trigger = React.Children.toArray(children).find(child => React.isValidElement(child) && child.type === AlertDialogTrigger);
  const content = React.Children.toArray(children).find(child => React.isValidElement(child) && child.type === AlertDialogContent);
  
  return (
    <AlertDialogContext.Provider value={contextValue}>
      {trigger}
      {isOpen && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center animate-in fade-in-0"
          // Close on overlay click
          onMouseDown={() => handleOpenChange(false)}
        >
          <div 
            className="relative bg-background p-6 rounded-lg shadow-lg max-w-lg w-full mx-4 animate-in zoom-in-95"
            // Prevent closing when clicking inside the dialog
            onMouseDown={(e) => e.stopPropagation()}
          >
            {content}
          </div>
        </div>
      )}
    </AlertDialogContext.Provider>
  );
}

// AlertDialogTrigger: The button that opens the dialog
export function AlertDialogTrigger({ children, asChild, ...props }) {
  const context = useContext(AlertDialogContext);
  if (!context) throw new Error("AlertDialogTrigger must be used within an AlertDialog");

  const handleClick = (e) => {
    e.stopPropagation();
    context.setIsOpen(true);
    if (asChild && children.props.onClick) {
      children.props.onClick(e);
    }
  };

  if (asChild) {
    return React.cloneElement(children, { ...props, onClick: handleClick });
  }

  return (
    <button onClick={handleClick} {...props}>
      {children}
    </button>
  );
}

// AlertDialogContent: Wrapper for the dialog's content. Now a simple container.
export function AlertDialogContent({ children, className, ...props }) {
  return <div className={className} {...props}>{children}</div>;
}

// Parts of the dialog content
export function AlertDialogHeader({ children, ...props }) {
  return <div className="space-y-2 text-center sm:text-left mb-4" {...props}>{children}</div>;
}

export function AlertDialogFooter({ children, ...props }) {
  return <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 mt-6" {...props}>{children}</div>;
}

export function AlertDialogTitle({ children, ...props }) {
  return <h2 className="text-lg font-semibold" {...props}>{children}</h2>;
}

export function AlertDialogDescription({ children, ...props }) {
  return <p className="text-sm text-muted-foreground" {...props}>{children}</p>;
}

export function AlertDialogAction({ children, onClick, ...props }) {
  const context = useContext(AlertDialogContext);
  if (!context) throw new Error("AlertDialogAction must be used within an AlertDialog");

  const handleClick = (e) => {
    if (onClick) onClick(e);
    context.setIsOpen(false);
  };
  
  return <Button onClick={handleClick} {...props}>{children}</Button>;
}

export function AlertDialogCancel({ children, onClick, ...props }) {
  const context = useContext(AlertDialogContext);
  if (!context) throw new Error("AlertDialogCancel must be used within an AlertDialog");

  const handleClick = (e) => {
    if (onClick) onClick(e);
    context.setIsOpen(false);
  };
  
  return <Button variant="outline" onClick={handleClick} {...props}>{children || 'Cancel'}</Button>;
}