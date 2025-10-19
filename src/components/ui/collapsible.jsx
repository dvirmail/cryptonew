import React, { useState, createContext, useContext } from 'react';

const CollapsibleContext = createContext(null);

export const Collapsible = ({ children, open: controlledOpen, onOpenChange, defaultOpen = false, ...props }) => {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  
  const toggle = React.useCallback(() => {
    const newOpenState = !open;
    if (isControlled) {
      onOpenChange(newOpenState);
    } else {
      setInternalOpen(newOpenState);
    }
  }, [isControlled, open, onOpenChange]);

  const contextValue = React.useMemo(() => ({ open, toggle }), [open, toggle]);

  return (
    <CollapsibleContext.Provider value={contextValue}>
      <div {...props}>{children}</div>
    </CollapsibleContext.Provider>
  );
};

export const CollapsibleTrigger = ({ children, asChild, ...props }) => {
  const context = useContext(CollapsibleContext);
  if (!context) {
    throw new Error("CollapsibleTrigger must be used within a Collapsible component");
  }

  const handleClick = (e) => {
    context.toggle();
    if (children.props.onClick) {
      children.props.onClick(e);
    }
  };

  if (asChild) {
    return React.cloneElement(children, {
      ...props,
      'data-state': context.open ? 'open' : 'closed',
      onClick: handleClick,
    });
  }
  
  return (
    <button type="button" onClick={handleClick} {...props} data-state={context.open ? 'open' : 'closed'}>
      {children}
    </button>
  );
};

export const CollapsibleContent = ({ children, className, ...props }) => {
  const context = useContext(CollapsibleContext);
    if (!context) {
    throw new Error("CollapsibleContent must be used within a Collapsible component");
  }

  return (
    <div
      className={`overflow-hidden transition-all duration-300 ease-in-out ${className}`}
      style={{
        maxHeight: context.open ? '1000px' : '0px',
      }}
      hidden={!context.open}
      {...props}
    >
      {children}
    </div>
  );
};