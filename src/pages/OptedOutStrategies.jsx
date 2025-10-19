import React, { useState, useEffect } from 'react';
import { OptedOutCombination } from '@/api/entities';
import { safeCombinationOperations } from '@/api/functions';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { RotateCcw, Loader2, ListX, AlertTriangle, Wifi, WifiOff } from 'lucide-react';
import { format } from 'date-fns';

export default function OptedOutStrategies() {
  const [optedOutList, setOptedOutList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reactivatingId, setReactivatingId] = useState(null);
  const [connectionError, setConnectionError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const { toast } = useToast();

  const loadOptedOut = async (isRetry = false) => {
    if (!isRetry) {
      setLoading(true);
    }
    
    try {
      setConnectionError(false);
      const list = await OptedOutCombination.list('-opted_out_date');
      setOptedOutList(list);
      setRetryCount(0);
      
      if (isRetry) {
        toast({
          title: "Connection Restored",
          description: "Successfully loaded opted-out strategies.",
        });
      }
    } catch (error) {
      console.error('Error loading opted-out strategies:', error);
      setConnectionError(true);
      
      if (!isRetry) {
        toast({
          title: "Connection Error",
          description: "Could not load opted-out strategies. Check your internet connection.",
          variant: "destructive",
        });
      }
      
      // Set empty list as fallback
      setOptedOutList([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOptedOut();
  }, []);

  const handleRetry = () => {
    setRetryCount(prev => prev + 1);
    loadOptedOut(true);
  };

  const handleReactivate = async (id) => {
    if (connectionError) {
      toast({
        title: "Offline Mode",
        description: "Cannot reactivate strategies while offline. Please check your connection.",
        variant: "destructive",
      });
      return;
    }

    setReactivatingId(id);
    try {
      const response = await safeCombinationOperations({
        action: 'reactivate_strategy',
        optOutId: id
      });

      if (response.data.success) {
        toast({
          title: "Strategy Reactivated",
          description: "The strategy has been removed from the opt-out list and any active instances have been purged. It can now be rediscovered by the backtester.",
        });
        loadOptedOut();
      } else {
        throw new Error(response.data.error || 'Failed to reactivate strategy.');
      }
    } catch (error) {
      toast({
        title: "Error",
        description: `Could not reactivate the strategy: ${error.message}`,
        variant: "destructive",
      });
    } finally {
      setReactivatingId(null);
    }
  };

  const SignalPill = ({ signal }) => (
    <Badge variant="secondary" className="mr-1 mb-1">{signal.type}</Badge>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-4 text-muted-foreground">Loading Opt-Out List...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Opted-Out Strategies</h1>
      
      {/* Connection Status Alert */}
      {connectionError && (
        <Alert variant="destructive">
          <WifiOff className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>Unable to connect to server. Data may be outdated.</span>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleRetry}
              disabled={loading}
            >
              <Wifi className="h-4 w-4 mr-2" />
              Retry ({retryCount})
            </Button>
          </AlertDescription>
        </Alert>
      )}
      
      <Card>
        <CardHeader>
          <CardTitle>Blocked Strategy Combinations</CardTitle>
          <CardDescription>
            These strategies will be ignored by the backtesting engine. Reactivating a strategy removes it from this list, allowing it to be rediscovered.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Strategy Name</TableHead>
                <TableHead>Combination Details</TableHead>
                <TableHead>Coin / Timeframe</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Date Blocked</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {optedOutList.length > 0 ? (
                optedOutList.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium max-w-[250px] truncate" title={item.strategyName}>
                      {item.strategyName || <span className="text-muted-foreground italic">N/A (Legacy)</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap max-w-xs">
                        {item.combination_details?.signals?.map((s, i) => <SignalPill key={i} signal={s} />)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{item.coin || 'ANY'}</Badge>
                      <Badge variant="outline" className="ml-2">{item.timeframe || 'ANY'}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={item.reason}>{item.reason}</TableCell>
                    <TableCell>
                      {item.opted_out_date ? format(new Date(item.opted_out_date), 'MMM dd, yyyy HH:mm') : 'Unknown'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleReactivate(item.id)}
                        disabled={reactivatingId === item.id || connectionError}
                        title={connectionError ? "Offline - Cannot reactivate" : "Reactivate Strategy"}
                      >
                        {reactivatingId === item.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RotateCcw className={`h-4 w-4 ${connectionError ? 'text-gray-400' : 'text-green-600'}`} />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">
                    {connectionError ? (
                      <div>
                        <AlertTriangle className="mx-auto h-12 w-12 text-muted-foreground/50" />
                        <h3 className="mt-2 text-xl font-semibold">Connection Error</h3>
                        <p className="text-muted-foreground">
                          Unable to load opted-out strategies. Please check your connection.
                        </p>
                      </div>
                    ) : (
                      <div>
                        <ListX className="mx-auto h-12 w-12 text-muted-foreground/50" />
                        <h3 className="mt-2 text-xl font-semibold">No Opted-Out Strategies</h3>
                        <p className="text-muted-foreground">
                          When you delete a strategy from the stats page, it will appear here.
                        </p>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}