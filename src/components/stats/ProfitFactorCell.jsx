import React from 'react';

const ProfitFactorCell = ({ value }) => {
  // Handle cases where value is not a number or is missing - add extra defensive checks
  const numValue = typeof value === 'number' ? value : parseFloat(value);
  
  if (isNaN(numValue) || numValue === null || numValue === undefined) {
    return <span className="text-muted-foreground">N/A</span>;
  }

  const isProfitable = numValue >= 1;
  const colorClass = isProfitable ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
  const barColorClass = isProfitable ? 'bg-green-500' : 'bg-red-500';

  // Scale: 
  // For P/F >= 1, we map the range [1, 2] to [0%, 100%]. Anything >= 2 gets 100%.
  // For P/F < 1, we map the range [1, 0] to [0%, 100%].
  const barWidth = isProfitable
    ? Math.min((numValue - 1) * 100, 100) 
    : Math.min((1 - numValue) * 100, 100);

  return (
    <div className="flex flex-col justify-center">
      <span className={`font-semibold ${colorClass}`}>{numValue.toFixed(2)}</span>
      <div className="relative h-1.5 w-20 bg-gray-200 dark:bg-gray-700 rounded-full mt-1 overflow-hidden">
        <div
          className={`absolute h-full rounded-full ${barColorClass}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>
    </div>
  );
};

export default ProfitFactorCell;