
import React, { useState, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { AlertCircle, Database, Trash2, RefreshCw, Hammer, HardHat, FileCog } from 'lucide-react';
import { purgeDemoData } from '@/api/functions';
import { migrateTradeHistory } from '@/api/functions';
import { migrateTradeCommissions } from '@/api/functions';
import { backfillTradeMode } from '@/api/functions';
import { backfillHistoricalPerformance } from '@/api/functions';
import { reconcileWalletState } from '@/api/functions';
import { clearCorruptedPositions } from '@/api/functions';
import { createBaselineSnapshot } from '@/api/functions'; // NEW IMPORT
import { useTradingMode } from '@/components/providers/TradingModeProvider';
import { useWallet } from '@/components/providers/WalletProvider';

const ActionCard = ({ title, description, buttonText, onAction, isLoading, variant = 'default', icon: Icon }) => {
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border-t">
      <div className="mb-2 sm:mb-0">
        <div className="flex items-center">
          <Icon className="h-5 w-5 mr-2" />
          <h3 className="font-semibold">{title}</h3>
        </div>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>
      <Button onClick={onAction} disabled={isLoading} variant={variant}>
        {isLoading ? (
          <>
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            Processing...
          </>
        ) : (
          buttonText
        )}
      </Button>
    </div>
  );
};

export default function DebugSettings() {
  const { toast } = useToast();
  const { tradingMode } = useTradingMode();
  const { refreshWallet } = useWallet();
  const [loadingStates, setLoadingStates] = useState({});

  const handleAction = useCallback(async (actionName, actionFn, params = {}) => {
    setLoadingStates(prev => ({ ...prev, [actionName]: true }));
    try {
      const response = await actionFn(params);
      const data = response?.data || response;

      // NEW: dump backend debug logs to browser console for immediate visibility
      if (data?.debugLogs?.length) {
        try {
          data.debugLogs.forEach((line) => {
            // Ensure prefix
            if (typeof line === 'string') {
              console.log(line.startsWith('[P&F_Debug]') ? line : `[P&F_Debug] ${line}`);
            } else {
              console.log('[P&F_Debug]', line);
            }
          });
        } catch (e) {
          console.log('[P&F_Debug] Error printing debugLogs', e);
        }
      }

      if (data?.success) {
        toast({
          title: "Success",
          description: data.message || `${actionName} completed successfully.`,
        });
        if (actionName === 'backfillHistory' || actionName === 'reconcileWallet' || actionName.startsWith('createBaseline')) {
            await refreshWallet();
        }
      } else {
        toast({
          title: "Error",
          description: data?.error || `An error occurred during ${actionName}.`,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error(`Error during ${actionName}:`, error);
      toast({
        title: "Request Failed",
        description: `Error during ${actionName}: - ${error.response?.data?.error || error.message}`,
        variant: "destructive",
      });
    } finally {
      setLoadingStates(prev => ({ ...prev, [actionName]: false }));
    }
  }, [toast, refreshWallet]);

  return (
    <div className="container mx-auto p-4 space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Debug & Maintenance</h1>
        <p className="text-muted-foreground">Tools for developers to manage and repair application data.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="border-red-500/50">
          <CardHeader>
            <div className="flex items-center text-red-600">
              <AlertCircle className="h-6 w-6 mr-2" />
              <CardTitle>Destructive Actions</CardTitle>
            </div>
            <CardDescription>These actions permanently delete data. Use with extreme caution.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ActionCard
              title="Purge Trading Data"
              description={`Deletes all wallet and trade history for the current mode (${tradingMode.toUpperCase()}). This cannot be undone.`}
              buttonText="Purge Data"
              onAction={() => handleAction('purgeData', purgeDemoData, { mode: tradingMode })}
              isLoading={loadingStates.purgeData}
              variant="destructive"
              icon={Trash2}
            />
             <ActionCard
              title="Clear Corrupted Positions"
              description="Forcefully removes any open positions from the database that may be stuck or corrupted. Does not affect Binance."
              buttonText="Clear Positions"
              onAction={() => handleAction('clearCorrupted', clearCorruptedPositions, { mode: tradingMode })}
              isLoading={loadingStates.clearCorrupted}
              variant="destructive"
              icon={Hammer}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center">
              <Database className="h-6 w-6 mr-2" />
              <CardTitle>Data Integrity & Maintenance</CardTitle>
            </div>
            <CardDescription>Use these tools to fix inconsistencies or backfill data.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ActionCard
              title="Reconcile Wallet State"
              description="Recalculates total P&L and cash balance from trade history."
              buttonText="Reconcile"
              onAction={() => handleAction('reconcileWallet', reconcileWalletState, { mode: tradingMode })}
              isLoading={loadingStates.reconcileWallet}
              icon={RefreshCw}
            />
            <ActionCard
              title="Rebuild Performance History"
              description="Deletes and regenerates all historical performance snapshots."
              buttonText="Rebuild"
              onAction={() => handleAction('backfillHistory', backfillHistoricalPerformance, { fullRebuild: true })}
              isLoading={loadingStates.backfillHistory}
              icon={HardHat}
            />
            <ActionCard
              title="Migrate Trade Commissions"
              description="Backfills commission data for older trades. Run this only once."
              buttonText="Migrate"
              onAction={() => handleAction('migrateCommissions', migrateTradeCommissions)}
              isLoading={loadingStates.migrateCommissions}
              icon={FileCog}
            />
            <ActionCard
              title="Backfill Trade Mode"
              description="Sets `trading_mode` to 'testnet' for old trades that are missing it."
              buttonText="Backfill"
              onAction={() => handleAction('backfillMode', backfillTradeMode)}
              isLoading={loadingStates.backfillMode}
              icon={FileCog}
            />
          </CardContent>
        </Card>

        {/* NEW: Create Performance Baseline Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center">
              <HardHat className="h-6 w-6 mr-2" />
              <CardTitle>Create Performance Baseline</CardTitle>
            </div>
            <CardDescription>
              If your performance history or profit factor seems incorrect, creating a baseline can fix it.
              This should only be done once. It takes your current total P&L and sets it as the starting point for "yesterday",
              so all future trades are calculated correctly as incremental changes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-6 pt-0"> {/* Added padding for better spacing */}
            <div className="flex items-center gap-4">
              <Button
                onClick={() => handleAction('createBaselineTestnet', createBaselineSnapshot, { mode: 'testnet' })}
                disabled={loadingStates.createBaselineTestnet}
              >
                {loadingStates.createBaselineTestnet ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create TESTNET Baseline"
                )}
              </Button>
              <Button
                onClick={() => handleAction('createBaselineLive', createBaselineSnapshot, { mode: 'live' })}
                disabled={loadingStates.createBaselineLive}
                variant="secondary"
              >
                {loadingStates.createBaselineLive ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create LIVE Baseline"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
