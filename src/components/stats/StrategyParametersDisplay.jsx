import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Percent,
  Shield,
  Target,
  Clock,
  SlidersHorizontal,
} from 'lucide-react';

const StatPill = ({ icon: Icon, label, value, unit, colorClass }) => (
  <div className={`flex flex-col items-center justify-center p-3 rounded-lg ${colorClass}`}>
    <div className="flex items-center gap-2 mb-1">
      <Icon className="h-4 w-4" />
      <span className="text-xs font-medium">{label}</span>
    </div>
    <div className="text-lg font-bold">
      {value}
      {unit && <span className="text-sm font-normal ml-1">{unit}</span>}
    </div>
  </div>
);

export default function StrategyParametersDisplay({ params }) {
  if (!params) {
    return (
      <div className="text-center text-sm text-muted-foreground p-4">
        Strategy parameters not found.
      </div>
    );
  }

  return (
    <div className="mb-4">
      <h4 className="font-semibold mb-3 flex items-center gap-2">
        <SlidersHorizontal className="h-4 w-4 text-primary" />
        Defined Strategy Parameters
      </h4>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatPill
          icon={Percent}
          label="Risk per Trade"
          value={params.riskPercentage?.toFixed(1) || 'N/A'}
          unit="%"
          colorClass="bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300"
        />
        <StatPill
          icon={Shield}
          label="SL Multiplier"
          value={params.stopLossAtrMultiplier?.toFixed(1) || 'N/A'}
          unit="ATR"
          colorClass="bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300"
        />
        <StatPill
          icon={Target}
          label="TP Multiplier"
          value={params.takeProfitAtrMultiplier?.toFixed(1) || 'N/A'}
          unit="ATR"
          colorClass="bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300"
        />
        <StatPill
          icon={Clock}
          label="Time Exit"
          value={params.estimatedExitTimeMinutes?.toFixed(0) || 'N/A'}
          unit="min"
          colorClass="bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-300"
        />
      </div>
    </div>
  );
}