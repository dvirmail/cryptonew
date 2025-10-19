
import React, { useState, useEffect } from 'react';
import { getAutoScannerService } from '@/components/services/AutoScannerService';
import { Play, Pause, Loader2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export default function ScanTimer() {
    const [status, setStatus] = useState('stopped');
    const [nextScanTime, setNextScanTime] = useState(null);
    const [timeLeft, setTimeLeft] = useState('--:--');
    const [isScanning, setIsScanning] = useState(false);

    useEffect(() => {
        const scannerService = getAutoScannerService();

        const handleStateChange = (newState) => {
            if (!newState) return;
            
            setStatus(newState.isRunning ? 'running' : 'stopped');
            setIsScanning(newState.isScanning || false);
            
            // **FIX**: Better handling of nextScanTime
            // Only set nextScanTime if running and not currently scanning
            if (newState.isRunning && newState.nextScanTime && !newState.isScanning) {
                setNextScanTime(new Date(newState.nextScanTime));
            } else {
                setNextScanTime(null);
            }
        };

        const unsubscribe = scannerService.subscribe(handleStateChange);
        
        // Get initial state
        const initialState = scannerService.getState();
        handleStateChange(initialState);

        return () => {
            if (unsubscribe && typeof unsubscribe === 'function') {
                unsubscribe();
            }
        };
    }, []);

    useEffect(() => {
        // **FIX**: Improved timer logic
        if (status !== 'running') {
            setTimeLeft('--:--');
            return;
        }

        if (isScanning) {
            setTimeLeft('SCAN');
            return;
        }

        if (!nextScanTime) {
            setTimeLeft('--:--');
            return;
        }

        const updateTimer = () => {
            const now = Date.now(); // Use Date.now() for millisecond precision
            const diff = nextScanTime.getTime() - now;

            if (diff <= 0) {
                setTimeLeft('00:00');
                // Consider clearing interval if it reaches 00:00 and nextScanTime won't change until next scan
                return;
            }

            const minutes = Math.floor(diff / 60000);
            const seconds = Math.floor((diff % 60000) / 1000);
            setTimeLeft(`${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`);
        };

        updateTimer(); // Initial call
        const timer = setInterval(updateTimer, 1000);

        return () => clearInterval(timer);
    }, [status, nextScanTime, isScanning]);

    const getStatusIcon = () => {
        if (status === 'running') {
            if (isScanning) {
                return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
            } else {
                return <Play className="h-4 w-4 text-green-500" />;
            }
        } else {
            return <Pause className="h-4 w-4 text-gray-400" />;
        }
    };

    const getTooltipText = () => {
        if (status === 'running') {
            if (isScanning) {
                return 'Scanner is actively scanning markets';
            } else if (nextScanTime) {
                return `Next scan in ${timeLeft}`;
            } else {
                return 'Scanner is running';
            }
        } else {
            return 'Scanner is stopped';
        }
    };

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <div className="flex items-center space-x-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 rounded-lg">
                        {getStatusIcon()}
                        <div className="text-sm font-mono text-gray-800 dark:text-gray-200 w-12 text-center">
                            {timeLeft}
                        </div>
                    </div>
                </TooltipTrigger>
                <TooltipContent>
                    <p>{getTooltipText()}</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}
