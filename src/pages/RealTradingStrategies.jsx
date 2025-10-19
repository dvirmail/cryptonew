import React, { useState, useEffect, useMemo } from "react";
import { BacktestCombination } from "@/api/entities";
import { User } from "@/api/entities";
import { safeCombinationOperations } from "@/api/functions";
import { toast } from "@/components/ui/use-toast";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Trash2,
  TrendingUp,
  BarChart3,
  Percent,
  Check,
  X,
  Bot,
  Loader2,
  ShieldAlert,
  ChevronDown,
  Plus,
  Minus,
  Filter,
  ArrowUp,
  ArrowDown,
  Timer,
  Scaling,
  Search,
  Zap,
  DollarSign,
  Target,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

export default function RealTradingStrategies() {
  const [user, setUser] = useState(null);
  const [allCombinations, setAllCombinations] = useState([]);
  const [filteredCombinations, setFilteredCombinations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(null);
  const [expandedRow, setExpandedRow] = useState(null);
  const [successRateFilter, setSuccessRateFilter] = useState([50]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortConfig, setSortConfig] = useState({ key: 'realSuccessRate', direction: 'desc' });

  // Bulk operations state
  const [selectedCombinations, setSelectedCombinations] = useState(new Set());
  const [bulkUpdating, setBulkUpdating] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const currentUser = await User.me();
        setUser(currentUser);

        if (currentUser) {
          const response = await safeCombinationOperations({
            action: 'getUserCombinations'
          });
          
          if (response.data.success) {
            setAllCombinations(response.data.combinations);
          } else {
            throw new Error(response.data.error || 'Failed to load combinations');
          }
        }
      } catch (error) {
        console.error("Error loading data:", error);
        toast({
          title: "Error",
          description: "Could not load strategies. Please ensure you are logged in.",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  // Filter combinations based on success rate and search query
  useEffect(() => {
    let filtered = allCombinations.filter(combo => 
      (combo.realSuccessRate || 0) >= successRateFilter[0]
    );

    if (searchQuery) {
      filtered = filtered.filter(combo =>
        combo.combinationName && combo.combinationName.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    setFilteredCombinations(filtered);
    // Clear selection if filtered items are no longer visible
    setSelectedCombinations(prevSelected => {
        const newSet = new Set();
        const filteredIds = new Set(filtered.map(c => c.id));
        prevSelected.forEach(id => {
            if (filteredIds.has(id)) {
                newSet.add(id);
            }
        });
        return newSet;
    });
  }, [allCombinations, successRateFilter, searchQuery]);

  const sortedAndFilteredCombinations = useMemo(() => {
    let sortableItems = [...filteredCombinations];
    if (sortConfig.key) {
      sortableItems.sort((a, b) => {
        const aValue = a[sortConfig.key] || 0;
        const bValue = b[sortConfig.key] || 0;

        if (typeof aValue === 'string' && typeof bValue === 'string') {
          return sortConfig.direction === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
        }
        
        if (aValue < bValue) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (aValue > bValue) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableItems;
  }, [filteredCombinations, sortConfig]);

  // Helper to check if the current user owns the combination
  const canEdit = (combination) => {
    if (!user) return false;
    if (!combination.created_by) return false;
    return combination.created_by === user.email || combination.created_by === user.id;
  };

  const toggleLiveScannerInclusion = async (combination) => {
    if (!user) {
      toast({
        title: "Error",
        description: "User not authenticated. Please refresh the page.",
        variant: "destructive",
      });
      return;
    }
    if (!canEdit(combination)) {
        toast({
            title: "Unauthorized",
            description: "You can only modify your own strategies.",
            variant: "destructive",
        });
        return;
    }

    setUpdating(combination.id);
    try {
      const response = await safeCombinationOperations({
        action: 'update',
        combinationId: combination.id,
        updateData: {
          includedInLiveScanner: !combination.includedInLiveScanner
        }
      });
      
      if (response.data.success) {
        setAllCombinations((prev) =>
          prev.map((c) =>
            c.id === combination.id ? response.data.combination : c
          )
        );
        
        toast({
          title: "Success",
          description: `Strategy ${
            response.data.combination.includedInLiveScanner ? "added to" : "removed from"
          } live trading.`,
        });
      } else {
        throw new Error(response.data.error || 'Failed to update strategy');
      }
    } catch (error) {
      console.error("Error updating live scanner inclusion:", error);
      toast({
        title: "Error",
        description: `Could not update strategy: ${error.message}`,
        variant: "destructive",
      });
    } finally {
      setUpdating(null);
    }
  };
  
  const getRiskProfile = (combination) => {
    const sr = combination.realSuccessRate || 0;
    const trades = combination.realTradeCount || 0;

    if (trades < 5) return "Insufficient Data";
    if (sr < 40) return "High Risk";
    if (sr >= 70) return "Low Risk";
    if (sr >= 55) return "Medium Risk";
    return "High Risk";
  };
  
  const getRiskColor = (risk) => {
      switch(risk) {
          case 'Low Risk': return 'text-green-500 bg-green-100 dark:bg-green-900/50';
          case 'Medium Risk': return 'text-yellow-500 bg-yellow-100 dark:bg-yellow-900/50';
          case 'High Risk': return 'text-red-500 bg-red-100 dark:bg-red-900/50';
          default: return 'text-gray-500 bg-gray-100 dark:bg-gray-900/50';
      }
  }

  const getPerformanceColor = (value, type) => {
    if (value === null || value === undefined || isNaN(value)) return 'text-muted-foreground';

    if (type === 'profitFactor') {
      if (value >= 2.0) return 'text-cyan-500 dark:text-cyan-400 font-bold';
      if (value >= 1.5) return 'text-green-600 dark:text-green-500 font-semibold';
      if (value >= 1.0) return 'text-yellow-600 dark:text-yellow-500';
      return 'text-red-600 dark:text-red-500';
    }

    if (type === 'winRate') {
      if (value >= 70) return 'text-cyan-500 dark:text-cyan-400 font-bold';
      if (value >= 55) return 'text-green-600 dark:text-green-500 font-semibold';
      if (value >= 40) return 'text-yellow-600 dark:text-yellow-500';
      return 'text-red-600 dark:text-red-500';
    }
    return '';
  };

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };
  
  const SortableHeader = ({ children, sortKey }) => (
    <TableHead
      onClick={() => handleSort(sortKey)}
      className="cursor-pointer select-none hover:bg-muted/50"
    >
      <div className="flex items-center gap-1">
        {children}
        {sortConfig.key === sortKey && (sortConfig.direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </div>
    </TableHead>
  );

  // Bulk selection handlers
  const handleSelectAll = () => {
    const editableFilteredCombinations = sortedAndFilteredCombinations.filter(canEdit);
    if (selectedCombinations.size === editableFilteredCombinations.length) {
      setSelectedCombinations(new Set());
    } else {
      setSelectedCombinations(new Set(editableFilteredCombinations.map(c => c.id)));
    }
  };

  const handleSelectCombination = (combinationId, isEditable) => {
    if (!isEditable) return;
    const newSelected = new Set(selectedCombinations);
    if (newSelected.has(combinationId)) {
      newSelected.delete(combinationId);
    } else {
      newSelected.add(combinationId);
    }
    setSelectedCombinations(newSelected);
  };

  const getSelectedEditableCombinations = () => {
    return allCombinations.filter(c => selectedCombinations.has(c.id) && canEdit(c));
  };

  const handleBulkUpdate = async (updateData, actionText) => {
    setBulkUpdating(true);
    const selected = getSelectedEditableCombinations();
    
    if (selected.length === 0) {
      toast({
        title: "No Strategies Selected",
        description: "Please select strategies to update.",
        variant: "default",
      });
      setBulkUpdating(false);
      return;
    }

    const selectedIds = selected.map(c => c.id);

    try {
      const response = await safeCombinationOperations({
        action: 'bulk_update',
        combinationIds: selectedIds,
        updateData: updateData
      });

      if (response.data.success) {
        const { successfulUpdates, failures } = response.data;

        // Update local state
        setAllCombinations(prev => {
          const updatedMap = new Map(successfulUpdates.map(c => [c.id, c]));
          return prev.map(c => updatedMap.get(c.id) || c);
        });
        
        setSelectedCombinations(new Set());

        if (failures && failures.length > 0) {
          toast({
            title: "Bulk Update Partially Successful",
            description: `${successfulUpdates.length} updated, ${failures.length} failed.`,
            variant: "warning",
          });
        } else {
          toast({
            title: "Bulk Update Complete",
            description: `Successfully ${actionText} ${successfulUpdates.length} strategies.`,
          });
        }
      } else {
        throw new Error(response.data.error || 'Bulk update failed.');
      }
    } catch (error) {
      console.error("Error during bulk update:", error);
      toast({
        title: "Error",
        description: `Failed to update strategies: ${error.message}`,
        variant: "destructive",
      });
    } finally {
      setBulkUpdating(false);
    }
  };

  const handleBulkAddToLiveTrading = async () => {
    await handleBulkUpdate({ includedInLiveScanner: true }, 'added to live trading');
  };

  const handleBulkRemoveFromLiveTrading = async () => {
    await handleBulkUpdate({ includedInLiveScanner: false }, 'removed from live trading');
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const editableCombinationsCount = sortedAndFilteredCombinations.filter(canEdit).length;
  const allEditableSelected = selectedCombinations.size === editableCombinationsCount && editableCombinationsCount > 0;
  const liveStrategiesCount = allCombinations.filter(c => c.includedInLiveScanner).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Real Trading Strategies</h1>
          <p className="text-muted-foreground">Manage strategies enabled for live trading with real money</p>
        </div>
        <div className="flex items-center gap-4">
          <Badge variant="secondary" className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-green-500" />
            {liveStrategiesCount} Live Strategies
          </Badge>
        </div>
      </div>

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Live Trading Warning</AlertTitle>
        <AlertDescription>
          Strategies marked for real trading will execute trades with actual money through your Binance account. 
          Ensure you have properly tested these strategies and configured appropriate risk limits.
        </AlertDescription>
      </Alert>

      {allCombinations.length > 0 ? (
        <div className="space-y-4">
          {/* Filter Section */}
          <div className="bg-muted/30 rounded-lg p-4 space-y-4">
            <div>
              <Label htmlFor="search-strategy" className="font-semibold">Search by Strategy Name</Label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    id="search-strategy"
                    placeholder="e.g., 'Valkyrie's Charge'..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                />
              </div>
            </div>
            
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-primary" />
                  <Label className="font-semibold">Filter by Demo Win Rate</Label>
                </div>
                <Badge variant="secondary" className="text-base font-bold px-4 py-1">
                  ≥ {successRateFilter[0]}%
                </Badge>
              </div>
              <Slider
                min={0}
                max={100}
                step={5}
                value={successRateFilter}
                onValueChange={setSuccessRateFilter}
                className="w-full mt-2"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>All (0%)</span>
                <span>Good (50%)</span>
                <span>Excellent (80%+)</span>
              </div>
            </div>

            <div className="text-sm text-muted-foreground pt-2 border-t border-border">
              Showing {filteredCombinations.length} of {allCombinations.length} strategies
            </div>
          </div>

          {/* Bulk Operations Controls */}
          <div className="flex flex-col sm:flex-row gap-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg items-center justify-between flex-wrap">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={allEditableSelected}
                onCheckedChange={handleSelectAll}
                disabled={editableCombinationsCount === 0}
              />
              <span className="text-sm font-medium">
                Select All Editable ({selectedCombinations.size} selected)
              </span>
            </div>
            
            <div className="flex flex-wrap gap-2">
              <Button
                variant="default"
                size="sm"
                onClick={handleBulkAddToLiveTrading}
                disabled={selectedCombinations.size === 0 || bulkUpdating}
                className="bg-green-600 hover:bg-green-700"
              >
                {bulkUpdating ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                Add to Live Trading
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                onClick={handleBulkRemoveFromLiveTrading}
                disabled={selectedCombinations.size === 0 || bulkUpdating}
                className="bg-red-50 hover:bg-red-100 text-red-700 border-red-200"
              >
                {bulkUpdating ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Minus className="h-4 w-4 mr-2" />
                )}
                Remove from Live Trading
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                        checked={allEditableSelected}
                        onCheckedChange={handleSelectAll}
                        disabled={editableCombinationsCount === 0}
                    />
                  </TableHead>
                  <SortableHeader sortKey="combinationName">Strategy Name</SortableHeader>
                  <SortableHeader sortKey="coin">Coin/Timeframe</SortableHeader>
                  <SortableHeader sortKey="realTradeCount">Demo Trades</SortableHeader>
                  <SortableHeader sortKey="realSuccessRate">Demo Win %</SortableHeader>
                  <SortableHeader sortKey="realProfitFactor">Demo Profit Factor</SortableHeader>
                  <TableHead className="text-center">Risk Level</TableHead>
                  <TableHead className="text-center">Live Trading Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedAndFilteredCombinations.map((combination) => {
                  const isEditable = canEdit(combination);
                  const riskProfile = getRiskProfile(combination);
                  return (
                    <TableRow key={combination.id} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                      <TableCell>
                        <Checkbox
                          checked={selectedCombinations.has(combination.id)}
                          onCheckedChange={() => handleSelectCombination(combination.id, isEditable)}
                          onClick={(e) => e.stopPropagation()}
                          disabled={!isEditable}
                        />
                      </TableCell>

                      <TableCell className="font-medium">
                        {combination.combinationName || "Unnamed Strategy"}
                      </TableCell>
                      
                      <TableCell>
                        <div className="space-y-1">
                          <Badge variant="outline">{combination.coin}</Badge>
                          <div className="text-xs text-gray-500">
                            {combination.timeframe}
                          </div>
                        </div>
                      </TableCell>
                      
                      <TableCell className="text-center font-bold">
                        {combination.realTradeCount || 0}
                      </TableCell>
                      
                      <TableCell className={`text-center ${getPerformanceColor(combination.realSuccessRate, 'winRate')}`}>
                        {(combination.realSuccessRate || 0).toFixed(1)}%
                      </TableCell>
                      
                      <TableCell className={`text-center ${getPerformanceColor(combination.realProfitFactor, 'profitFactor')}`}>
                        {(combination.realProfitFactor || 0).toFixed(2)}
                      </TableCell>
                      
                      <TableCell className="text-center">
                        <Badge
                          variant="outline"
                          className={getRiskColor(riskProfile)}
                        >
                          {riskProfile}
                        </Badge>
                      </TableCell>
                      
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleLiveScannerInclusion(combination);
                          }}
                          disabled={updating === combination.id || !isEditable}
                          className="p-1 h-8 w-8"
                        >
                          {updating === combination.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : combination.includedInLiveScanner ? (
                            <CheckCircle className="h-4 w-4 text-green-600" />
                          ) : (
                            <X className="h-4 w-4 text-gray-400" />
                          )}
                        </Button>
                      </TableCell>
                      
                      <TableCell className="text-right">
                        <Button
                          variant={combination.includedInLiveScanner ? "destructive" : "default"}
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleLiveScannerInclusion(combination);
                          }}
                          disabled={updating === combination.id || !isEditable}
                          className={combination.includedInLiveScanner ? "" : "bg-green-600 hover:bg-green-700"}
                        >
                          {updating === combination.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : combination.includedInLiveScanner ? (
                            <>
                              <Minus className="h-4 w-4 mr-2" />
                              Remove
                            </>
                          ) : (
                            <>
                              <Plus className="h-4 w-4 mr-2" />
                              Add to Live
                            </>
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : (
        <div className="text-center py-8">
          <Alert>
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>No Strategies Available</AlertTitle>
            <AlertDescription>
              You haven't created any trading strategies yet. Run some backtests and save successful combinations to manage them here.
            </AlertDescription>
          </Alert>
        </div>
      )}
    </div>
  );
}