
import React, { useEffect, useRef } from 'react';

export function Dialog({ children, open, onOpenChange, contentClassName }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape' && open && onOpenChange) {
        onOpenChange(false);
      }
    };

    document.addEventListener('keydown', handleEsc);

    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto">
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={() => onOpenChange && onOpenChange(false)} />

      <div className="relative bg-white dark:bg-gray-800 rounded-lg Changed from max-w-6xl to max-w-[95vw] w-[1000px]"

      ref={dialogRef}
      onClick={(e) => e.stopPropagation()}>

        {children}
      </div>
    </div>);

}

export function DialogTrigger({ children, asChild, ...props }) {
  if (asChild && React.Children.count(children) === 1) {
    return React.cloneElement(children, props);
  }

  return (
    <button {...props}>
      {children}
    </button>);

}

export function DialogContent({ children, className = "", ...props }) {
  return (
    <div className={`relative ${className}`} {...props}>
      {children}
    </div>);

}

export function DialogHeader({ className = "", ...props }) {
  return (
    <div className={`mb-4 ${className}`} {...props} />);

}

export function DialogFooter({ className = "", ...props }) {
  return (
    <div className={`mt-4 flex justify-end gap-3 ${className}`} {...props} />);

}

export function DialogTitle({ className = "", ...props }) {
  return (
    <h2 className={`text-xl font-semibold ${className}`} {...props} />);

}

export function DialogDescription({ className = "", ...props }) {
  return (
    <p className={`text-sm text-gray-500 dark:text-gray-400 ${className}`} {...props} />);

}