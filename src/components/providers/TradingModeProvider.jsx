
import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { getAutoScannerService } from '@/components/services/AutoScannerService';
import { useToast } from "@/components/ui/use-toast";
import { queueFunctionCall, queueEntityCall } from '@/components/utils/apiQueue';
import { functions } from '@/api/localClient';
import { ScanSettings } from '@/api/entities';

const TradingModeContext = createContext(null);

export const useTradingMode = () => {
  const context = useContext(TradingModeContext);
  if (!context) {
    throw new Error('useTradingMode must be used within a TradingModeProvider');
  }
  return context;
};

export const TradingModeProvider = ({ children }) => {
  const [tradingMode, setTradingMode] = useState('testnet'); // 'testnet' or 'live'
  const [areLiveKeysValid, setAreLiveKeysValid] = useState(false);
  const [areTestnetKeysValid, setAreTestnetKeysValid] = useState(false);
  const [isCheckingKeys, setIsCheckingKeys] = useState(true);
  const scannerService = getAutoScannerService();
  const { toast } = useToast();

  // Function to check Binance API keys
  const checkApiKeys = useCallback(async (silent = false) => {
    setIsCheckingKeys(true);
    let currentLiveKeysValid = false;
    let currentTestnetKeysValid = false;
    try {
      // Check localStorage for API keys (local development setup)
      const savedKeys = localStorage.getItem('binanceApiKeys');
      if (!savedKeys) {
        console.warn('No API keys found in localStorage. Cannot check API keys.');
        if (!silent) {
          toast({
            title: "API Key Check Warning",
            description: "No API keys found. Please configure your Binance API keys in Settings.",
            variant: "warning",
          });
        }
        setAreLiveKeysValid(false);
        setAreTestnetKeysValid(false);
        return;
      }

      const keys = JSON.parse(savedKeys);

      // Check live keys
      if (keys.liveApiKey && keys.liveApiSecret) {
        const liveKeyTestResult = await functions.testBinanceKeys({
          mode: 'live',
          proxyUrl: 'http://localhost:3003'
        });
        currentLiveKeysValid = liveKeyTestResult.success;
      }
      setAreLiveKeysValid(currentLiveKeysValid);

      // Check testnet keys
      if (keys.testnetApiKey && keys.testnetApiSecret) {
        const testnetKeyTestResult = await functions.testBinanceKeys({
          mode: 'testnet',
          proxyUrl: 'http://localhost:3003'
        });
        currentTestnetKeysValid = testnetKeyTestResult.success;
      }
      setAreTestnetKeysValid(currentTestnetKeysValid);

    } catch (error) {
      console.error('Error checking API keys:', error);
      if (!silent) {
        toast({
          title: "API Key Check Failed",
          description: `Failed to check Binance API keys: ${error.message}`,
          variant: "destructive",
        });
      }
      setAreLiveKeysValid(false);
      setAreTestnetKeysValid(false);
    } finally {
      setIsCheckingKeys(false);
    }
  }, [toast]);

  // Initial load effect
  useEffect(() => {
    const initializeTradingMode = async () => {
      setIsCheckingKeys(true);
      let initialMode = 'testnet';
      let currentLiveKeysValid = false;
      let currentTestnetKeysValid = false;

      try {
        const settingsList = await queueEntityCall('ScanSettings', 'list');
        const settings = settingsList?.[0];

        if (settings) {
          // Check if trading mode flags exist, otherwise default to testnet
          if (settings.isLiveTradingEnabled) {
            initialMode = 'live';
          } else if (settings.isTestnetTradingEnabled) {
            initialMode = 'testnet';
          } else {
            // No trading mode flags found, default to testnet and add them
            initialMode = 'testnet';
            console.log('No trading mode flags found in ScanSettings. Defaulting to testnet and adding flags.');
            
            // Update the settings with trading mode flags
            await queueEntityCall('ScanSettings', 'update', settings.id, {
              isLiveTradingEnabled: false,
              isTestnetTradingEnabled: true
            });
          }
        } else {
          console.warn('No ScanSettings found in database. Initializing to testnet.');
          toast({
            title: "Settings Not Found",
            description: "No scanner settings found. Defaulting to Testnet mode.",
            variant: "warning",
          });
        }

        // Check API keys from localStorage (local development setup)
        const savedKeys = localStorage.getItem('binanceApiKeys');
        if (savedKeys) {
          const keys = JSON.parse(savedKeys);
          
          // Check live keys
          if (keys.liveApiKey && keys.liveApiSecret) {
            const liveKeyTestResult = await functions.testBinanceKeys({
              mode: 'live',
              proxyUrl: 'http://localhost:3003'
            });
            currentLiveKeysValid = liveKeyTestResult.success;
          }

          // Check testnet keys
          if (keys.testnetApiKey && keys.testnetApiSecret) {
            const testnetKeyTestResult = await functions.testBinanceKeys({
              mode: 'testnet',
              proxyUrl: 'http://localhost:3003'
            });
            currentTestnetKeysValid = testnetKeyTestResult.success;
          }
        }

        // Apply initial mode and key validity
        setTradingMode(initialMode);
        setAreLiveKeysValid(currentLiveKeysValid);
        setAreTestnetKeysValid(currentTestnetKeysValid);

        // Inform the scanner service of the initial mode
        if (scannerService) {
          scannerService.setTradingMode(initialMode);
          // Also initialize scannerService's settings object if it's there
          if (scannerService.state.settings && settings) {
            scannerService.state.settings.isLiveTradingEnabled = settings.isLiveTradingEnabled;
            scannerService.state.settings.isTestnetTradingEnabled = settings.isTestnetTradingEnabled;
          }
        }

      } catch (error) {
        console.error('Error initializing trading mode or checking keys:', error);
        toast({
          title: "Initialization Failed",
          description: `Failed to load trading mode or check keys: ${error.message}. Defaulting to Testnet.`,
          variant: "destructive",
        });
        setTradingMode('testnet'); // Default to testnet on error
        setAreLiveKeysValid(false);
        setAreTestnetKeysValid(false);
      } finally {
        setIsCheckingKeys(false);
      }
    };

    initializeTradingMode();

    // Set up interval for key checks
    const interval = setInterval(() => checkApiKeys(true), 5 * 60 * 1000); // Check keys every 5 minutes (silent)
    return () => clearInterval(interval);
  }, [checkApiKeys, scannerService, toast]);

  const toggleMode = useCallback(async () => {
    const newMode = tradingMode === 'testnet' ? 'live' : 'testnet';
    const oldMode = tradingMode;

    if (newMode === 'live' && !areLiveKeysValid) {
      toast({
        title: "Live Trading Disabled",
        description: "Valid Binance API keys for live trading are required. Please configure them in settings.",
        variant: "destructive",
      });
      return;
    }

    if (newMode === 'testnet' && !areTestnetKeysValid) {
      toast({
        title: "Testnet Trading Disabled",
        description: "Valid Binance API keys for testnet trading are required. Please configure them in settings.",
        variant: "destructive",
      });
      return;
    }

    try {
      const settingsList = await queueEntityCall('ScanSettings', 'list');
      if (!settingsList || settingsList.length === 0) {
        toast({
          title: "Error",
          description: "Could not load scanner settings to update trading mode. Please create settings first.",
          variant: "destructive",
        });
        return;
      }
      const currentSettings = settingsList[0];
      const settingsUpdate = {
        isLiveTradingEnabled: newMode === 'live',
        isTestnetTradingEnabled: newMode === 'testnet',
      };

      console.log(`[TradingModeProvider] Updating trading mode to ${newMode}`, settingsUpdate);
      await queueEntityCall('ScanSettings', 'update', currentSettings.id, settingsUpdate);

      // This is crucial: we also update the settings in the running scanner service instance
      // so it doesn't have to wait for the next full settings refresh.
      if (scannerService && scannerService.state.settings) {
        scannerService.state.settings.isLiveTradingEnabled = settingsUpdate.isLiveTradingEnabled;
        scannerService.state.settings.isTestnetTradingEnabled = settingsUpdate.isTestnetTradingEnabled;
      }

      // If scanner is running, stop it, change mode, then restart.
      if (scannerService && scannerService.getState().isRunning) {
        scannerService.stop();
        await new Promise(resolve => setTimeout(resolve, 500)); // Give it a moment to stop
        console.log(`[MODE_SWITCH] Scanner stopped before switching to ${newMode} mode.`);
        scannerService.setTradingMode(newMode);
        scannerService.start(); // Restart after mode change
        toast({
          title: "Trading Mode Changed & Scanner Restarted",
          description: `Switched to ${newMode.toUpperCase()} mode. Scanner has been restarted.`,
          variant: "default"
        });
      } else {
        scannerService.setTradingMode(newMode);
        toast({
          title: "Trading Mode Changed",
          description: `Switched to ${newMode.toUpperCase()} mode.`,
          variant: "default"
        });
      }
      
      setTradingMode(newMode); // Update local state after successful DB update
      
    } catch (error) {
      console.error('Error switching trading mode:', error);
      toast({
        title: "Mode Switch Failed",
        description: `Failed to switch to ${newMode} mode: ${error.message}`,
        variant: "destructive",
      });
      // Revert local state if DB update failed (optional, but good practice)
      setTradingMode(oldMode);
    }
  }, [tradingMode, areLiveKeysValid, areTestnetKeysValid, scannerService, toast]);

  const value = {
    tradingMode,
    isLiveMode: tradingMode === 'live', // Provide isLiveMode for existing consumers
    toggleMode,
    areLiveKeysValid,
    areTestnetKeysValid,
    isCheckingKeys,
  };

  return (
    <TradingModeContext.Provider value={value}>
      {children}
    </TradingModeContext.Provider>
  );
};
