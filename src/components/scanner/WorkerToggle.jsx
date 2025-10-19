import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Cpu, Zap, AlertTriangle, CheckCircle } from 'lucide-react';

export default function WorkerToggle({ 
  isUsingWorker, 
  workerAvailable, 
  onToggleWorker, 
  disabled = false,
  scannerRunning = false 
}) {
  const canToggle = !disabled && !scannerRunning && workerAvailable;

  const getStatusInfo = () => {
    if (!workerAvailable) {
      return {
        icon: <AlertTriangle className="h-4 w-4" />,
        status: 'Web Workers not supported',
        color: 'destructive',
        description: 'Your browser does not support Web Workers or they failed to initialize.'
      };
    }

    if (isUsingWorker) {
      return {
        icon: <Zap className="h-4 w-4" />,
        status: 'Web Worker Mode',
        color: 'default',
        description: 'Scanner runs in background thread for better performance and stability.'
      };
    }

    return {
      icon: <Cpu className="h-4 w-4" />,
      status: 'Main Thread Mode',
      color: 'secondary',
      description: 'Scanner runs on main thread. May cause UI freezing during intensive scans.'
    };
  };

  const statusInfo = getStatusInfo();

  return (
    <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-medium text-gray-900 dark:text-white flex items-center gap-2">
          {statusInfo.icon}
          Execution Mode
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge variant={statusInfo.color} className="flex items-center gap-1">
              {statusInfo.status}
            </Badge>
            {isUsingWorker && workerAvailable && (
              <Badge variant="outline" className="flex items-center gap-1">
                <CheckCircle className="h-3 w-3" />
                Active
              </Badge>
            )}
          </div>
          
          {workerAvailable && (
            <Switch
              checked={isUsingWorker}
              onCheckedChange={onToggleWorker}
              disabled={!canToggle}
            />
          )}
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-400">
          {statusInfo.description}
        </p>

        {scannerRunning && (
          <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              <AlertTriangle className="h-4 w-4 inline mr-1" />
              Cannot change execution mode while scanner is running. Stop the scanner first.
            </p>
          </div>
        )}

        {!workerAvailable && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
            <p className="text-sm text-red-800 dark:text-red-200">
              Web Workers are not available in this browser environment. 
              The scanner will run on the main thread, which may cause performance issues.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 pt-2">
          <div className="text-center p-2 bg-gray-50 dark:bg-gray-700/50 rounded">
            <div className="text-sm font-medium text-gray-900 dark:text-white">
              {isUsingWorker ? 'Non-blocking' : 'May block UI'}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              UI Responsiveness
            </div>
          </div>
          <div className="text-center p-2 bg-gray-50 dark:bg-gray-700/50 rounded">
            <div className="text-sm font-medium text-gray-900 dark:text-white">
              {isUsingWorker ? 'Isolated' : 'Shared'}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Memory Space
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}