
import React from 'react';
import { Button } from '@/components/ui/button';
import { Play, Pause, RefreshCw, Trash2, PowerOff, AlertTriangle, Square } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertDialogTrigger } from "@/components/ui/alert-dialog"; // Ensure AlertDialogTrigger is imported
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function ScannerControls({ 
    scannerState, 
    onStart, 
    onStop, 
    onRestart,
    onHardReset,
    onClearLogs,
    isGloballyActive,
    isLeader,
    sessionMessage,
    isLiveMode = false,
    binanceKeysValid = false
}) {
    const isRunning = scannerState?.isRunning || false;
    const isInitializing = scannerState?.isInitializing || false;
    const isScanning = scannerState?.isScanning || false;

    // UPDATED: Remove key-validity gating so start is allowed even with invalid keys
    const isStartDisabled = isGloballyActive || isInitializing || isScanning;
    const isStopDisabled = !isRunning || !isLeader;
    
    // NEW: Show "Take Control" when another tab is leader
    const showTakeControl = isGloballyActive && !isLeader && !isRunning;
    
    const getBadgeVariant = () => {
        if (isLeader) return "success"; 
        if (isGloballyActive && !isLeader) return "destructive";
        return "secondary";
    };

    // NEW: Force claim handler
    const handleTakeControl = async () => {
        const { getAutoScannerService } = await import('@/components/services/AutoScannerService');
        const service = getAutoScannerService();
        // The start method should ideally be called from AutoScanner.js which manages the state
        // For this UI component, we trigger a specific action which the parent (AutoScanner.js) should handle
        // by calling service.sessionManager.start(true).
        // For now, let's assume `onStart` or a new prop `onTakeControl` would handle this.
        // Given the outline, `handleTakeControl` directly calls the service.
        const success = await service.sessionManager.start(true); // Pass force=true
        
        if (success) {
            // Toast notification handled by AutoScan.js via the service's toast notifier
            // Or if `onStart` is passed as a prop that handles this, it would be called.
            // For now, no explicit toast here as outline says it's handled by AutoScan.js
        }
    };

    return (
        <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow space-y-4">
            {/* UPDATED: Warning only, no blocking */}
            {!binanceKeysValid && (
                <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                        {isLiveMode 
                            ? 'Live Binance API keys are invalid. Scanner can still start, but trading and wallet sync may be limited.'
                            : 'Testnet Binance API keys are invalid. Scanner can still start, but trading and wallet sync may be limited.'
                        }
                    </AlertDescription>
                </Alert>
            )}

            <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-2">
                    {!isRunning && !showTakeControl ? (
                        <Button onClick={onStart} disabled={isStartDisabled} className="bg-green-600 hover:bg-green-700">
                            <Play className="mr-2 h-4 w-4" />
                            {isLiveMode ? 'Start Live Trading' : 'Start Testnet Scanner'}
                        </Button>
                    ) : showTakeControl ? (
                        // NEW: Take Control button when another tab is leader
                        <Button onClick={handleTakeControl} variant="destructive" className="bg-orange-600 hover:bg-orange-700">
                            <Play className="mr-2 h-4 w-4" />
                            Take Control (Override Other Tab)
                        </Button>
                    ) : (
                        <Button onClick={onStop} disabled={isStopDisabled} className="bg-red-600 hover:bg-red-700">
                            <Pause className="mr-2 h-4 w-4" />
                            {isLiveMode ? 'Stop Live Trading' : 'Stop Testnet Scanner'}
                        </Button>
                    )}
                    
                    {/* Emergency Stop Button - Always visible when running */}
                    {isRunning && (
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="destructive" className="bg-red-700 hover:bg-red-800">
                                    <Square className="mr-2 h-4 w-4" />
                                    Emergency Stop
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Emergency Stop Scanner?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        This will immediately stop all scanner operations and halt any pending trades.
                                        {isLiveMode && ' Any ongoing live trades will be interrupted.'}
                                        This action cannot be undone.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction 
                                        onClick={onStop} 
                                        className="bg-red-600 hover:bg-red-700"
                                    >
                                        Yes, Emergency Stop
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    )}
                    
                    <Button onClick={onRestart} variant="outline" disabled={!isRunning && !isInitializing}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Restart
                    </Button>
                </div>
                
                <div className="flex items-center gap-2">
                    <Badge variant={getBadgeVariant()}>
                        {sessionMessage}
                    </Badge>
                    <Badge variant={binanceKeysValid ? (isLiveMode ? "default" : "secondary") : "destructive"}>
                        {isLiveMode 
                            ? (binanceKeysValid ? 'Live Connected' : 'Live Keys Invalid')
                            : (binanceKeysValid ? 'Testnet Connected' : 'Testnet Keys Invalid')
                        }
                    </Badge>
                </div>
                
                <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={onClearLogs} variant="secondary">
                        <Trash2 className="mr-2 h-4 w-4" />
                        Clear Logs
                    </Button>
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button variant="destructive">
                                <PowerOff className="mr-2 h-4 w-4" />
                                {isLiveMode ? 'Reset Live Account' : 'Reset Testnet Account'}
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    {isLiveMode 
                                        ? 'This will close all live positions and reset your live trading session. This action cannot be undone.'
                                        : 'This will close all testnet positions and reset your testnet trading session. This action cannot be undone.'
                                    }
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={onHardReset} className="bg-red-600 hover:bg-red-700">
                                    {isLiveMode ? 'Yes, Reset Live Account' : 'Yes, Reset Testnet Account'}
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            </div>
        </div>
    );
}
