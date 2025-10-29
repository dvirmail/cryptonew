import React from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const SignalBadges = ({ signals }) => {
  // Ensure signals is an array
  const signalsArray = Array.isArray(signals) ? signals : [];
  
  if (!signalsArray || signalsArray.length === 0) {
    return <span className="text-xs text-muted-foreground">N/A</span>;
  }

  const visibleSignals = signalsArray.slice(0, 2);
  const hiddenSignalsCount = signalsArray.length - visibleSignals.length;

  return (
    <TooltipProvider delayDuration={100}>
      <div className="flex flex-wrap items-center gap-1 max-w-[200px]">
        {visibleSignals.map((signal, index) => (
          <Tooltip key={index}>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="cursor-default truncate">
                {signal.type}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="font-semibold">{signal.type}</p>
              <p>{signal.value}</p>
              {signal.details && <p className="text-xs text-muted-foreground">{signal.details}</p>}
            </TooltipContent>
          </Tooltip>
        ))}
        {hiddenSignalsCount > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="secondary" className="cursor-default">
                +{hiddenSignalsCount}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="font-semibold mb-2">All Signals:</p>
              <ul className="list-disc list-inside space-y-1">
                {signalsArray.map((s, i) => (
                  <li key={i}>
                    <strong>{s.type}</strong>: {s.value}
                  </li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
};

export default SignalBadges;