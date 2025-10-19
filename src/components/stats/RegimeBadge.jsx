import React from 'react';
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Waves, Zap } from 'lucide-react';

const RegimeBadge = ({ regime }) => {
  const regimeConfig = {
    trending: {
      style: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 hover:bg-green-200',
      icon: <TrendingUp className="h-3 w-3 mr-1" />,
    },
    ranging: {
      style: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 hover:bg-yellow-200',
      icon: <Waves className="h-3 w-3 mr-1" />,
    },
    volatile: {
      style: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 hover:bg-red-200',
      icon: <Zap className="h-3 w-3 mr-1" />,
    },
    'n/a': {
      style: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
      icon: null,
    },
  };

  const config = regimeConfig[regime?.toLowerCase()] || regimeConfig['n/a'];

  return (
    <Badge variant="outline" className={`capitalize border-0 flex items-center ${config.style}`}>
      {config.icon}
      {regime || 'N/A'}
    </Badge>
  );
};

export default RegimeBadge;