import React from "react";
import { cn } from "@/components/utils/utils";

const Slider = React.forwardRef(({ className, min = 0, max = 100, step = 1, value = [0], onValueChange, ...props }, ref) => {
  const handleChange = (e) => {
    const newValue = parseFloat(e.target.value);
    if (onValueChange) {
      onValueChange([newValue]);
    }
  };

  const currentValue = Array.isArray(value) ? value[0] : value;

  return (
    <div className={cn("relative flex items-center", className)}>
      <input
        ref={ref}
        type="range"
        min={min}
        max={max}
        step={step}
        value={currentValue}
        onChange={handleChange}
        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 slider"
        {...props}
      />
      <style>{`
        .slider::-webkit-slider-thumb {
          appearance: none;
          height: 20px;
          width: 20px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }
        
        .slider::-moz-range-thumb {
          height: 20px;
          width: 20px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          border: none;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }
        
        .slider::-webkit-slider-track {
          height: 8px;
          background: linear-gradient(to right, #3b82f6 0%, #3b82f6 ${((currentValue - min) / (max - min)) * 100}%, #e5e7eb ${((currentValue - min) / (max - min)) * 100}%, #e5e7eb 100%);
          border-radius: 4px;
        }
        
        .slider::-moz-range-track {
          height: 8px;
          background: #e5e7eb;
          border-radius: 4px;
        }
        
        .slider::-moz-range-progress {
          height: 8px;
          background: #3b82f6;
          border-radius: 4px;
        }
      `}</style>
    </div>
  );
});

Slider.displayName = "Slider";

export { Slider };