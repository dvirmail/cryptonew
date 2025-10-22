
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { getAutoScannerService } from "@/components/services/AutoScannerService";
import { ScanSettings } from '@/api/entities';
import ScannerControls from "@/components/scanner/ScannerControls";
import ScannerStats from "@/components/scanner/ScannerStats";
import LogDisplay from "@/components/scanner/LogDisplay";
import ScannerConfiguration from '@/components/scanner/ScannerConfiguration';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Info, AlertTriangle, TrendingUp, Play } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { queueEntityCall } from "@/components/utils/apiQueue";
import { Badge } from "@/components/ui/badge";
import { scannerSessionManager } from "@/api/functions";
import { testBinanceKeys } from "@/api/functions";
import { generateTradeId } from "@/components/utils/id";
import { debounce } from "@/components/utils/utils";

export default function AutoScan() {
    const scannerService = useRef(getAutoScannerService());
    const [scannerState, setScannerState] = useState(scannerService.current.getState());
    const [logs, setLogs] = useState([]);
    const previousModeRef = useRef(scannerState?.tradingMode); // NEW: track previous mode
    const [config, setConfig] = useState(null);
    const [isLoadingConfig, setIsLoadingConfig] = useState(false);
    const [saving, setSaving] = useState(false);
    const [binanceKeysValid, setBinanceKeysValid] = useState(false);
    const [checkingKeys, setCheckingKeys] = useState(false);
    const [sessionStatus, setSessionStatus] = useState({ isLeader: false, isGloballyActive: false, message: "Initializing..." });
    const { toast } = useToast();

    // Local per-mode stats persistence/override
    const defaultStats = useCallback(() => ({
        totalScanCycles: 0,
        totalScans: 0,
        signalsFound: 0,
        tradesExecuted: 0,
        averageScanTimeMs: null,
        lastScanTimeMs: null,
        averageSignalStrength: null,
        lastCycleAverageSignalStrength: null,
        lastUpdated: new Date().toISOString()
    }), []);

    const [statsOverride, setStatsOverride] = useState(null);
    const statsRecordIdRef = useRef({ testnet: null, live: null }); // Use an object to store record IDs for both testnet and live
    const modeRef = useRef(scannerState?.tradingMode || 'testnet'); // Keep track of the current mode for persistence

    // Persist stats (debounced) to ScannerStats entity
    const persistStats = useMemo(() => debounce(async (mode, stats) => {
        if (!mode) return;
        const recordId = statsRecordIdRef.current[mode];
        const payload = { ...stats, mode, lastUpdated: new Date().toISOString() };

        if (recordId) {
            await queueEntityCall('ScannerStats', 'update', recordId, payload);
        } else {
            const created = await queueEntityCall('ScannerStats', 'create', payload);
            if (created && created.id) {
                statsRecordIdRef.current[mode] = created.id;
            }
        }
    }, 800), []); // Empty dependency array as queueEntityCall and debounce are stable

    // Load stats for current mode (or create defaults)
    const loadModeStats = useCallback(async (mode, { reset = false } = {}) => {
        modeRef.current = mode || 'testnet'; // Update ref to current mode

        if (reset) {
            const fresh = defaultStats();
            setStatsOverride(fresh);
            // Persist immediately if reset
            const created = await queueEntityCall('ScannerStats', 'create', { ...fresh, mode: modeRef.current });
            if (created && created.id) {
                statsRecordIdRef.current[modeRef.current] = created.id;
            }
            return;
        }

        try {
            const found = await queueEntityCall('ScannerStats', 'filter', { mode: modeRef.current }, '-updated_date', 1);
            if (Array.isArray(found) && found.length > 0) {
                setStatsOverride({
                    totalScanCycles: found[0].totalScanCycles ?? 0,
                    totalScans: found[0].totalScans ?? 0,
                    signalsFound: found[0].signalsFound ?? 0,
                    tradesExecuted: found[0].tradesExecuted ?? 0,
                    averageScanTimeMs: found[0].averageScanTimeMs ?? null,
                    lastScanTimeMs: found[0].lastScanTimeMs ?? null,
                    averageSignalStrength: found[0].averageSignalStrength ?? null,
                    lastCycleAverageSignalStrength: found[0].lastCycleAverageSignalStrength ?? null,
                    lastUpdated: found[0].lastUpdated ?? new Date().toISOString()
                });
                statsRecordIdRef.current[modeRef.current] = found[0].id;
            } else {
                const fresh = defaultStats();
                setStatsOverride(fresh);
                const created = await queueEntityCall('ScannerStats', 'create', { ...fresh, mode: modeRef.current });
                if (created && created.id) {
                    statsRecordIdRef.current[modeRef.current] = created.id;
                }
            }
        } catch (error) {
            console.error(`Error loading stats for mode ${mode}:`, error);
            const fresh = defaultStats();
            setStatsOverride(fresh);
            // Attempt to create a new one even if loading failed
            const created = await queueEntityCall('ScannerStats', 'create', { ...fresh, mode: modeRef.current });
            if (created && created.id) {
                statsRecordIdRef.current[modeRef.current] = created.id;
            }
        }
    }, [defaultStats, queueEntityCall]); // Added queueEntityCall to deps as it's used directly here

    // Persist sessionId across hot reloads for this tab
    const getOrCreateSessionId = () => {
        const key = 'scanner_session_id';
        let id = sessionStorage.getItem(key);
        if (!id) {
            id = `session_${generateTradeId()}`;
            sessionStorage.setItem(key, id);
        }
        return id;
    };
    
    const sessionIdRef = useRef(getOrCreateSessionId());
    const previousLogsRef = useRef([]);
    const scannerStateRef = useRef(null); 
    const isInitializedRef = useRef(false);
    const hasAutoStartedRef = useRef(false); // NEW: prevent double auto-start
    const startAfterInitTimerRef = useRef(null); // NEW: to debounce post-init start
    const autoStartAttemptedRef = useRef(false); // NEW: Track if we've attempted auto-start at all

    const isLiveMode = scannerState.tradingMode === 'live';

    // STABLE: updateSessionStatus with no dependencies
    const updateSessionStatus = useCallback((status) => {
        setSessionStatus(prev => {
            if (JSON.stringify(prev) !== JSON.stringify(status)) {
                return status;
            }
            return prev;
        });
    }, []); // Empty dependencies - this function never changes

    // STABLE: loadConfiguration with toast as only dependency
    const loadConfiguration = useCallback(async () => {
        setIsLoadingConfig(true); // Move state update inside
        try {
            const settings = await queueEntityCall('ScanSettings', 'list');
            if (settings && settings.length > 0) {
                const savedConfig = settings[0];
                setConfig({
                    scanFrequency: savedConfig.scanFrequency || 300000,
                    minimumCombinedStrength: savedConfig.minimumCombinedStrength || 225,
                    maxPositions: savedConfig.maxPositions || 10,
                    riskPerTrade: savedConfig.riskPerTrade || 2,
                    portfolioHeatMax: savedConfig.portfolioHeatMax || 20,
                    minimumTradeValue: savedConfig.minimumTradeValue || 10,
                    defaultPositionSize: savedConfig.defaultPositionSize || 100,
                    useWinStrategySize: savedConfig.useWinStrategySize !== undefined ? savedConfig.useWinStrategySize : true,
                    minimumRegimeConfidence: savedConfig.minimumRegimeConfidence !== undefined ? savedConfig.minimumRegimeConfidence : 60,
                    minimumConvictionScore: savedConfig.minimumConvictionScore !== undefined ? savedConfig.minimumConvictionScore : 50,
                    signalMatchingMode: savedConfig.signalMatchingMode || 'conviction_based',
                    // NEW: load downtrend block toggle
                    blockTradingInDowntrend: savedConfig.blockTradingInDowntrend !== undefined ? savedConfig.blockTradingInDowntrend : false,
                    // NEW: load resetStatsOnModeSwitch
                    resetStatsOnModeSwitch: savedConfig.resetStatsOnModeSwitch !== undefined ? savedConfig.resetStatsOnModeSwitch : false,
                });
            } else {
                const defaultConfig = {
                    scanFrequency: 100,
                    minimumCombinedStrength: 250,
                    maxPositions: 1,
                    riskPerTrade: 2,
                    portfolioHeatMax: 80,
                    minimumTradeValue: 10,
                    defaultPositionSize: 100,
                    useWinStrategySize: true,
                    minimumRegimeConfidence: 60,
                    minimumConvictionScore: 50,
                    signalMatchingMode: 'conviction_based',
                    // NEW default
                    blockTradingInDowntrend: false,
                    // NEW default for resetStatsOnModeSwitch
                    resetStatsOnModeSwitch: false,
                };
                setConfig(defaultConfig);
                await queueEntityCall('ScanSettings', 'create', defaultConfig);
            }
        } catch (error) {
            console.error('Error loading configuration:', error);
            toast({
                title: "Error",
                description: "Failed to load scanner configuration",
                variant: "destructive"
            });
        } finally {
            setIsLoadingConfig(false); // Move state update inside
        }
    }, [toast]); // Only toast dependency

    // STABLE: checkBinanceKeys with toast and updateSessionStatus as dependencies
    const checkBinanceKeys = useCallback(async (mode, { silent = false } = {}) => {
        if (!mode) return;
        
        setCheckingKeys(true); // Move state update inside
        try {
            // Check localStorage for API keys (local development setup)
            const savedKeys = localStorage.getItem('binanceApiKeys');
            if (!savedKeys) {
                setBinanceKeysValid(false);
                if (!silent) {
                    toast({
                        title: "No API Keys Found",
                        description: "Please configure your Binance API keys in Settings first",
                        variant: "destructive"
                    });
                }
                updateSessionStatus(prev => ({...prev, message: "API Keys Missing"}));
                return;
            }

            const keys = JSON.parse(savedKeys);
            const apiKey = mode === 'live' ? keys.liveApiKey : keys.testnetApiKey;
            const apiSecret = mode === 'live' ? keys.liveApiSecret : keys.testnetApiSecret;

            if (!apiKey || !apiSecret) {
                setBinanceKeysValid(false);
                if (!silent) {
                    toast({
                        title: `Missing ${mode.charAt(0).toUpperCase() + mode.slice(1)} Keys`,
                        description: `Please configure ${mode} API keys in Settings`,
                        variant: "destructive"
                    });
                }
                updateSessionStatus(prev => ({...prev, message: `Missing ${mode} API Keys`}));
                return;
            }

            const response = await testBinanceKeys({
                mode: mode,
                proxyUrl: 'http://localhost:3003'
            });
            
            if (response?.data?.success) {
                setBinanceKeysValid(true);
            } else {
                setBinanceKeysValid(false);
                if (!silent) {
                    toast({
                        title: `${mode.charAt(0).toUpperCase() + mode.slice(1)} Connection Failed`,
                        description: response?.data?.message || "Invalid API credentials",
                        variant: "destructive"
                    });
                }
                updateSessionStatus(prev => ({...prev, message: `Invalid ${mode} API Keys`}));
            }
        } catch (error) {
            setBinanceKeysValid(false);
            if (!silent) {
                toast({
                    title: "Connection Test Failed",
                    description: error.message,
                    variant: "destructive"
                });
            }
            updateSessionStatus(prev => ({...prev, message: `Failed to test ${mode} API Keys`}));
            console.error(`Error checking ${mode} keys:`, error);
        } finally {
            setCheckingKeys(false); // Move state update inside
        }
    }, [toast, updateSessionStatus]); // Stable dependencies

    // Compute per-cycle average strength purely from current logs
    const avgStrengthThisCycle = useMemo(() => {
        if (!Array.isArray(logs) || logs.length === 0) return null;

        // Refined extractor: only count strategy-level strength, not per-indicator values
        const extractStrengthFromMessage = (message = "") => {
            if (!message || typeof message !== "string") return null;
            if (/scanned strategies avg strength/i.test(message)) return null; // ignore injected summary
            if (/>>>>>\s/.test(message)) return null;                          // ignore signal detail lines
            if (/\(Strength:\s*-?\d+\.?\d*\)/i.test(message)) return null;     // ignore inline indicator strengths
            let m = message.match(/Live\s+Strength:\s*(-?\d+\.?\d*)/i);
            if (m && m[1] != null) {
                const v = Number(m[1]); 
                return Number.isFinite(v) ? v : null;
            }
            m = message.match(/Combined[\s_]*Strength[^0-9\-]*(-?\d+\.?\d*)/i);
            if (m && m[1] != null) {
                const v = Number(m[1]);
                return Number.isFinite(v) ? v : null;
            }
            return null;
        };

        const extractStrengthFromLog = (log) => {
            const d = log?.data || {};
            const candidates = [
                d.combinedStrength,
                d.combined_strength
            ].map((v) => (typeof v === "number" ? v : Number(v)));
            for (const v of candidates) {
                if (Number.isFinite(v) && Math.abs(v) < 10000) return v;
            }
            return extractStrengthFromMessage(log?.message || "");
        };

        const isCycleMarker = (log) => {
            if (log?.type === 'cycle') return true;
            const msg = typeof log?.message === 'string' ? log.message : '';
            return /scan cycle/i.test(msg) && /(complete|end|summary)/i.test(msg);
        };

        // Limit to current/last cycle window
        let startIdx = -1;
        for (let i = logs.length - 1; i >= 0; i--) {
            if (isCycleMarker(logs[i])) { startIdx = i; break; }
        }
        const sliceStart = startIdx >= 0 ? startIdx : Math.max(0, logs.length - 300);
        const windowLogs = logs.slice(sliceStart);

        let sum = 0;
        let count = 0;
        for (const lg of windowLogs) {
            const s = extractStrengthFromLog(lg);
            if (Number.isFinite(s)) {
                sum += s;
                count += 1;
            }
        }
        if (count === 0) return null;
        return sum / count;
    }, [logs]);

    // MAIN EFFECT: Runs only once when component mounts
    useEffect(() => {
        if (isInitializedRef.current) {
            return;
        }

        isInitializedRef.current = true;
        
        const service = scannerService.current;
        service.setSessionId(sessionIdRef.current);

        // NEW: Block the service's internal persisted auto-start; UI will orchestrate a single start after init
        if (typeof service.setAutoStartBlocked === 'function') {
            service.setAutoStartBlocked(true);
        }

        service.registerToastNotifier(toast);

        const handleStateChange = (newState) => {
            if (!newState) return;
            
            scannerStateRef.current = newState;
            setScannerState(newState);
            
            // Check for errors in the state
            if (newState.error) {
                toast({
                    title: "Scanner Error",
                    description: `${newState.errorSource || 'Error'}: ${newState.error}`,
                    variant: "destructive"
                });
            }
            
            if (newState.logs?.activity) {
                const activityLogs = Array.isArray(newState.logs.activity) ? newState.logs.activity : [];
                if (activityLogs.length !== (previousLogsRef.current?.length || 0)) {
                    const limitedLogs = activityLogs.slice(0, 500);
                    previousLogsRef.current = limitedLogs;
                    setLogs(limitedLogs);
                }
            }

            const amLeader = service.sessionId === newState.leaderSessionId;
            const isGloballyActive = Boolean(newState.isGloballyActive);

            let message = "Scanner is stopped.";
            if (isGloballyActive) {
                if (amLeader) message = "This tab is the leader.";
                else message = "Running in another tab.";
            } else if (newState.isRunning) {
                message = "Starting...";
            }
            
            updateSessionStatus({ isLeader: amLeader, isGloballyActive, message });

            // CRITICAL: Single auto-start attempt after initialization
            if (
                newState.isInitialized &&
                !newState.isRunning &&
                !hasAutoStartedRef.current &&
                !autoStartAttemptedRef.current // NEW: Ensure we only attempt once EVER
            ) {
                // Mark that we're attempting auto-start
                autoStartAttemptedRef.current = true;

                // Clear any existing timer
                if (startAfterInitTimerRef.current) {
                    clearTimeout(startAfterInitTimerRef.current);
                }

                // Longer debounce to let state fully settle
                startAfterInitTimerRef.current = setTimeout(async () => {
                    // Get the absolute latest state before attempting start
                    const currentServiceState = service.getState();
                    const currentIsGloballyActive = Boolean(currentServiceState.isGloballyActive);
                    const currentLeader = currentServiceState.leaderSessionId;
                    
                    // Check if another tab is already the active leader
                    if (currentIsGloballyActive && currentLeader && service.sessionId !== currentLeader) {
                        hasAutoStartedRef.current = true;
                        toast({
                            title: "Start Skipped",
                            description: "Another tab is already running the scanner.",
                            variant: "default"
                        });
                        return;
                    }

                    try {
                        const started = await service.start();
                        hasAutoStartedRef.current = true;

                        if (started) {
                            toast({
                                title: "Scanner Started",
                                description: "Started automatically after initialization.",
                                variant: "default"
                            });
                        } else {
                            toast({
                                title: "Start Failed",
                                description: "Failed to acquire session leadership during auto-start.",
                                variant: "destructive"
                            });
                        }
                    } catch (error) {
                        console.error('[AutoScan.js] Auto-start error:', error);
                        hasAutoStartedRef.current = true;
                        toast({
                            title: "Start Error",
                            description: `Auto-start error: ${error.message}`,
                            variant: "destructive"
                        });
                    }
                }, 2000); // Increased to 2000ms to prevent rapid session cycling during development
            }
        };
        
        const unsubscribe = service.subscribe(handleStateChange);
        
        // Initial data loads
        loadConfiguration();
        checkBinanceKeys(service.getTradingMode(), { silent: true });
        // Initial load of mode-specific stats (will be overwritten by tradingMode useEffect if needed)
        loadModeStats(service.getTradingMode());
        
        // Initial state sync
        handleStateChange(service.getState());

        // REMOVED: previous immediate auto-start on mount to avoid race with initialization

        return () => {
            if (unsubscribe && typeof unsubscribe === 'function') {
                unsubscribe();
            }
            if (startAfterInitTimerRef.current) {
                clearTimeout(startAfterInitTimerRef.current);
                startAfterInitTimerRef.current = null;
            }
            previousLogsRef.current = [];
            scannerStateRef.current = null;
            isInitializedRef.current = false;
            hasAutoStartedRef.current = false;
            autoStartAttemptedRef.current = false;
        };
    }, [toast, updateSessionStatus, loadConfiguration, checkBinanceKeys, loadModeStats]); // Added loadModeStats dependency

    // Ensure session release on browser/tab refresh or navigation
    useEffect(() => {
        let isUnmounting = false;
        
        const handler = () => {
            if (isUnmounting) return; // Prevent double cleanup
            try {
                const service = scannerService.current;
                if (service && service.getState().isRunning && service.sessionId === service.getState().leaderSessionId) {
                    console.log('[AutoScan.js] Releasing session on page unload');
                    service.stop();
                }
            } catch (e) {
                console.warn('[AutoScan.js] Cleanup stop() warning on unload:', e?.message);
            }
        };
        
        // Only add listeners for actual page unload events
        window.addEventListener('beforeunload', handler);
        window.addEventListener('pagehide', handler);
        
        return () => {
            isUnmounting = true;
            window.removeEventListener('beforeunload', handler);
            window.removeEventListener('pagehide', handler);
        };
    }, []);

    // SEPARATE EFFECT: Only for trading mode changes
    useEffect(() => {
        // When the mode actually changes, clear logs to isolate per-mode history
        if (previousModeRef.current !== scannerState.tradingMode && scannerState.tradingMode) {
            const service = scannerService.current;
            if (service && typeof service.clearLogs === 'function') {
                service.clearLogs();
            }
            setLogs([]); // clear UI buffer immediately
            previousModeRef.current = scannerState.tradingMode;
        }

        // This effect runs after the initial mount effect and when tradingMode changes.
        // `isInitializedRef.current` ensures it doesn't run before the service is fully set up.
        if (isInitializedRef.current && scannerState.tradingMode) {
            checkBinanceKeys(scannerState.tradingMode, { silent: true });
            // When mode changes, optionally reset or load per-mode stats
            if (config && config.resetStatsOnModeSwitch === true) {
                loadModeStats(scannerState.tradingMode, { reset: true });
            } else {
                loadModeStats(scannerState.tradingMode);
            }
        }
    }, [scannerState.tradingMode, checkBinanceKeys, loadModeStats, config]); // Added config dependency

    // SEPARATE EFFECT: Merge live scanner stats into per-mode override and persist
    useEffect(() => {
        const currentMode = scannerState?.tradingMode || 'testnet';
        const s = scannerState?.stats;
        // Only update if service stats exist and are different from previous or current `statsOverride`
        if (!s || Object.keys(s).length === 0) return;

        setStatsOverride(prev => {
            // Check if service stats are meaningfully different from the current override state to avoid unnecessary re-renders/persists
            const isStatsDifferent = (prevStats, newStats) => {
                if (!prevStats) return true; // If no previous, it's different
                for (const key of Object.keys(newStats)) {
                    if (prevStats[key] !== newStats[key]) {
                        // Exclude `lastUpdated` from diff check for triggering persistence
                        if (key !== 'lastUpdated') {
                             return true;
                        }
                    }
                }
                return false;
            }

            const merged = {
                totalScanCycles: s.totalScanCycles ?? prev?.totalScanCycles ?? 0,
                totalScans: s.totalScans ?? prev?.totalScans ?? 0,
                signalsFound: s.signalsFound ?? prev?.signalsFound ?? 0,
                tradesExecuted: s.tradesExecuted ?? prev?.tradesExecuted ?? 0,
                averageScanTimeMs: s.averageScanTimeMs ?? prev?.averageScanTimeMs ?? null,
                lastScanTimeMs: s.lastScanTimeMs ?? prev?.lastScanTimeMs ?? null,
                averageSignalStrength: s.averageSignalStrength ?? prev?.averageSignalStrength ?? null,
                lastCycleAverageSignalStrength: s.lastCycleAverageSignalStrength ?? prev?.lastCycleAverageSignalStrength ?? null,
                lastUpdated: new Date().toISOString()
            };

            if (isStatsDifferent(prev, merged)) {
                // Persist debounced only if there's a meaningful change
                persistStats(currentMode, merged);
                return merged;
            }
            return prev; // No change, return previous state
        });
    }, [scannerState.stats, scannerState.tradingMode, persistStats]);

    const handleConfigChange = useCallback((key, value) => {
        setConfig(prev => ({
            ...prev,
            [key]: value
        }));
    }, []);

    const handleSaveConfig = useCallback(async () => {
        if (!config || saving) return;
        setSaving(true);
        try {
            const settings = await queueEntityCall('ScanSettings', 'list');
            
            const configToSave = { ...config };

            if (settings.length > 0) {
                await queueEntityCall('ScanSettings', 'update', settings[0].id, configToSave);
            } else {
                await queueEntityCall('ScanSettings', 'create', configToSave);
            }

            const service = scannerService.current;
            const wasRunning = service.getState().isRunning;
            
            if (wasRunning) {
                service.stop(); 
                await new Promise(resolve => setTimeout(resolve, 1000));
                await service.updateSettings(configToSave);
                await service.start();
                
                toast({
                    title: "Configuration Updated & Scanner Restarted",
                    description: "Scanner has been restarted with the new configuration settings",
                    variant: "default"
                });
            } else {
                await service.updateSettings(configToSave);
                
                toast({
                    title: "Configuration Saved",
                    description: "Scanner configuration has been updated successfully",
                    variant: "default"
                });
            }
            setConfig(configToSave);
            // Do a silent key check after save so users can save even if keys are missing
            try {
                await Promise.race([
                    checkBinanceKeys(scannerService.current.getTradingMode(), { silent: true }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Key check timeout')), 10000))
                ]);
            } catch (error) {
                console.warn('Key check failed or timed out during save:', error.message);
            } 
        } catch (error) {
            console.error('Error saving configuration:', error);
            toast({
                title: "Error",
                description: "Failed to save scanner configuration",
                variant: "destructive"
            });
        } finally {
            setSaving(false);
        }
    }, [config, saving, toast, checkBinanceKeys]);

    const handleStart = useCallback(async () => {
        const service = scannerService.current;
        if (!service) return; // Removed binanceKeysValid check
        const started = await service.start();
        if (started) {
            updateSessionStatus({ isLeader: true, isGloballyActive: true, message: "This tab is the leader." });
            toast({
                title: "Scanner Started",
                description: "Scanner started successfully.",
                variant: "default"
            });
        } else {
            const { data } = await scannerSessionManager({ action: 'getSessionStatus' });
            updateSessionStatus({
                isLeader: data.active_session_id === sessionIdRef.current,
                isGloballyActive: data.is_active,
                message: data.is_active ? "Running in another tab" : "Start failed or session taken by another tab."
            });
             toast({
                title: "Scanner Start Failed",
                description: data.is_active ? "Another tab is already running the scanner." : "Failed to acquire session leadership.",
                variant: "destructive"
            });
        }
    }, [updateSessionStatus, toast]); // UPDATED: removed key validity gating

    const handleStop = useCallback(() => {
        const service = scannerService.current;
        if (service) {
            service.stop();
            updateSessionStatus({ isLeader: false, isGloballyActive: false, message: "Scanner is stopped." });
            toast({
                title: "Scanner Stopped",
                description: "The scanner has been successfully stopped.",
                variant: "default"
            });
        }
    }, [updateSessionStatus, toast]);
    
    const handleRestart = useCallback(async () => {
        const service = scannerService.current;
        if (service) {
            await service.restart();
            toast({
                title: "Scanner Restarted",
                description: "The scanner has been successfully restarted.",
                variant: "default"
            });
        }
    }, [toast]);

    const handleHardReset = useCallback(async () => {
        const service = scannerService.current;
        if (service) {
            // First, persist the current stats with zeros, then reset the service's wallet.
            // This ensures the current mode's stats are cleared from persistence before the service potentially starts anew.
            const currentMode = modeRef.current;
            await loadModeStats(currentMode, { reset: true }); // Resets and persists to backend
            
            await service.resetWalletAndRestart();
            toast({
                title: "Scanner Hard Reset & Wallet Cleared",
                description: "The scanner and virtual wallet have been reset and restarted, and stats for the current mode cleared.",
                variant: "default"
            });
        }
    }, [toast, loadModeStats]); // Added loadModeStats dependency

    const handleClearLogs = useCallback(() => {
        const service = scannerService.current;
        if (service) {
            service.clearLogs();
        }
    }, []);

    const handleModeChange = useCallback((mode) => {
        const service = scannerService.current;
        if (service) {
            // NEW: clear logs immediately on user-triggered mode change
            if (typeof service.clearLogs === 'function') {
                service.clearLogs();
            }
            setLogs([]);
            service.setTradingMode(mode);
            toast({
                title: "Trading Mode Changed",
                description: `Scanner is now in ${mode.toUpperCase()} mode.`,
                variant: "default"
            });
        }
    }, [toast]);

    if (isLoadingConfig) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4"></div>
                    <p>Loading scanner configuration...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="container mx-auto p-4 space-y-6">
            <div className="flex items-center justify-between">
                <div className="space-y-1">
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <Play className="h-8 w-8 text-blue-600" />
                        Auto Scanner
                        <Badge variant={isLiveMode ? "default" : "secondary"} className="text-sm">
                            {isLiveMode ? 'LIVE MODE' : 'TESTNET MODE'}
                        </Badge>
                        <Badge variant={binanceKeysValid ? "default" : "destructive"} className="text-sm">
                            {checkingKeys ? 'Checking Keys...' : (binanceKeysValid ? 'Keys Valid' : 'Keys Invalid')}
                        </Badge>
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400">
                        {isLiveMode 
                            ? 'Live trading with real money - Use with extreme caution!'
                            : 'Testnet trading with simulated funds - Safe for testing strategies'
                        }
                    </p>
                </div>
            </div>

            {scannerState && <ScannerStats stats={statsOverride || scannerState.stats} />}

            <ScannerControls
                scannerState={scannerState}
                onStart={handleStart}
                onStop={handleStop}
                onRestart={handleRestart}
                onHardReset={handleHardReset}
                onClearLogs={handleClearLogs}
                isGloballyActive={sessionStatus.isGloballyActive}
                isLeader={sessionStatus.isLeader}
                sessionMessage={sessionStatus.message}
                isLiveMode={isLiveMode}
                binanceKeysValid={binanceKeysValid}
            />
            
            <Tabs defaultValue="activity" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="configuration">Configuration</TabsTrigger>
                    <TabsTrigger value="activity">Activity Log ({logs.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="configuration" className="space-y-4">
                    {config && (
                        <ScannerConfiguration 
                            config={config}
                            isLoadingConfig={isLoadingConfig}
                            saving={saving}
                            onConfigChange={handleConfigChange}
                            onSaveConfig={handleSaveConfig}
                            currentTradingMode={scannerState.tradingMode}
                            binanceKeysValid={binanceKeysValid}
                            onModeChange={handleModeChange}
                        />
                    )}
                </TabsContent>

                <TabsContent value="activity" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Scanner Activity Log</CardTitle>
                            <CardDescription>
                                Showing the last 500 entries from recent scan cycles. Real-time updates as the scanner processes strategies and signals. 
                                {isLiveMode ? ' Live trading events will be highlighted.' : ' Testnet trading simulation events.'}
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <LogDisplay 
                                logs={logs}
                                // Prefer per-cycle stat derived from logs in this page; fallback to service stats
                                currentAverageSignalStrength={
                                    (Number.isFinite(avgStrengthThisCycle) ? avgStrengthThisCycle : null) ??
                                    (statsOverride?.lastCycleAverageSignalStrength ?? null) ?? // Prefer statsOverride
                                    scannerState?.stats?.lastCycleAverageSignalStrength ??
                                    (statsOverride?.averageSignalStrength ?? null) ?? // Fallback to statsOverride overall avg
                                    scannerState?.stats?.averageSignalStrength ??
                                    null
                                }
                            />
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
