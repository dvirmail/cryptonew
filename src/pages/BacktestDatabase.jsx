
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { BacktestCombination } from '@/api/entities';
import { useToast } from "@/components/ui/use-toast";
import { Link } from 'react-router-dom';

// UI Components
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Pagination } from '@/components/ui/Pagination';
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import RegimeBadge from '@/components/stats/RegimeBadge';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Dialogs
import EditStrategyDialog from '@/components/stats/EditStrategyDialog';
import OptOutDialog from '@/components/stats/OptOutDialog';
import ProfitFactorCell from '@/components/stats/ProfitFactorCell';

// Icons
import { Loader2, Trash2, ShieldOff, ArrowUp, ArrowDown, ArrowUpDown, ShieldAlert, ChevronDown, Zap, ZapOff, Compass } from "lucide-react";

// Helper Functions
const createPageUrl = (path) => `/${path}`;
const ROWS_PER_PAGE = 20;

const getSortIcon = (key, sortConfig) => {
  if (sortConfig.key === key) {
    return sortConfig.direction === 'asc' ? <ArrowUp className="ml-1 h-3 w-3 inline-block" /> : <ArrowDown className="ml-1 h-3 w-3 inline-block" />;
  }
  return <ArrowUpDown className="ml-1 h-3 w-3 inline-block text-muted-foreground" />;
};


export default function BacktestDatabase() {
    const { toast } = useToast();
    const [combinations, setCombinations] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [sortConfig, setSortConfig] = useState({ key: 'successRate', direction: 'desc' });
    const [currentPage, setCurrentPage] = useState(1);
    const [selectedCombination, setSelectedCombination] = useState(null);
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [isOptOutDialogOpen, setIsOptOutDialogOpen] = useState(false);
    const [selectedIds, setSelectedIds] = useState(new Set());

    const regimeSummary = useMemo(() => {
        return combinations.reduce((acc, combo) => {
            const regime = combo.dominantMarketRegime || 'N/A';
            acc[regime] = (acc[regime] || 0) + 1;
            return acc;
        }, {});
    }, [combinations]);

    const fetchCombinations = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await BacktestCombination.list();
            setCombinations(data);
            setSelectedIds(new Set()); // Clear selection on refetch
        } catch (error) {
            console.error("Failed to fetch backtest combinations:", error);
            toast({
                title: "Error",
                description: "Could not fetch combinations.",
                variant: "destructive",
            });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchCombinations();
    }, [fetchCombinations]);

    const handleEdit = (combination) => {
        setSelectedCombination(combination);
        setIsEditDialogOpen(true);
    };

    const handleOptOut = (combination) => {
        setSelectedCombination(combination);
        setIsOptOutDialogOpen(true);
    };

    const handleDelete = async (combinationId) => {
        if (!confirm("Are you sure you want to delete this combination? This action cannot be undone.")) {
            return;
        }
        try {
            await BacktestCombination.delete(combinationId);
            setCombinations(prev => prev.filter(c => c.id !== combinationId));
            toast({
                title: "Success",
                description: "Combination deleted successfully.",
            });
        } catch (error) {
            console.error("Failed to delete combination:", error);
            toast({
                title: "Error",
                description: "Could not delete combination.",
                variant: "destructive",
            });
        }
    };

    const handleToggleScanner = async (combinationId, newStatus) => {
        try {
            await BacktestCombination.update(combinationId, { includedInScanner: newStatus });
            setCombinations(prev => prev.map(c =>
                c.id === combinationId ? { ...c, includedInScanner: newStatus } : c
            ));
            toast({
                title: "Success",
                description: `Strategy has been ${newStatus ? 'enabled' : 'disabled'} for the demo scanner.`,
            });
        } catch (error) {
            console.error("Failed to update scanner status:", error);
            toast({
                title: "Error",
                description: "Could not update scanner status.",
                variant: "destructive",
            });
        }
    };
    
    const handleToggleLiveScanner = async (combinationId, newStatus) => {
        try {
            await BacktestCombination.update(combinationId, { includedInLiveScanner: newStatus });
            setCombinations(prev => prev.map(c =>
                c.id === combinationId ? { ...c, includedInLiveScanner: newStatus } : c
            ));
            toast({
                title: "Success",
                description: `Strategy has been ${newStatus ? 'enabled' : 'disabled'} for the live scanner.`,
            });
        } catch (error) {
            console.error("Failed to update live scanner status:", error);
            toast({
                title: "Error",
                description: "Could not update live scanner status.",
                variant: "destructive",
            });
        }
    };

    const handleConfirmOptOut = async (combinationToOptOut, scope) => {
        // This is a placeholder for the actual opt-out logic.
        // For now, it will show a success message and refetch the data.
        toast({
            title: "Opt-out Confirmed (Simulated)",
            description: `Strategy ${combinationToOptOut.combinationName} was opted out with scope: ${scope}.`,
        });
        setIsOptOutDialogOpen(false);
        await fetchCombinations();
    };

    const sortedCombinations = useMemo(() => {
        let sortableItems = [...combinations];
        if (sortConfig.key) {
            sortableItems.sort((a, b) => {
                const aValue = a[sortConfig.key];
                const bValue = b[sortConfig.key];
                const safeA = aValue === undefined || aValue === null ? (typeof aValue === 'string' ? '' : -Infinity) : aValue;
                const safeB = bValue === undefined || bValue === null ? (typeof bValue === 'string' ? '' : -Infinity) : bValue;
                if (typeof safeA === 'string' && typeof safeB === 'string') {
                    return sortConfig.direction === 'asc' ? safeA.localeCompare(safeB) : safeB.localeCompare(safeA);
                }
                if (safeA < safeB) return sortConfig.direction === 'asc' ? -1 : 1;
                if (safeA > safeB) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return sortableItems;
    }, [combinations, sortConfig]);

    const paginatedCombinations = useMemo(() => {
        const startIndex = (currentPage - 1) * ROWS_PER_PAGE;
        return sortedCombinations.slice(startIndex, startIndex + ROWS_PER_PAGE);
    }, [sortedCombinations, currentPage]);

    const totalPages = Math.ceil(sortedCombinations.length / ROWS_PER_PAGE);

    const requestSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
        setCurrentPage(1);
    };

    const handleSelectOne = (id, checked) => {
        setSelectedIds(prev => {
            const newSet = new Set(prev);
            if (checked) newSet.add(id);
            else newSet.delete(id);
            return newSet;
        });
    };

    const handleSelectAll = (checked) => {
        if (checked) {
            setSelectedIds(new Set(paginatedCombinations.map(c => c.id)));
        } else {
            setSelectedIds(new Set());
        }
    };

    const handleBulkUpdate = async (field, value) => {
        if (selectedIds.size === 0) return;
        try {
            await Promise.all(
                Array.from(selectedIds).map(id => BacktestCombination.update(id, { [field]: value }))
            );
            toast({
                title: "Bulk Update Successful",
                description: `${selectedIds.size} strategies have been updated.`,
            });
            await fetchCombinations();
        } catch (error) {
            console.error("Bulk update failed:", error);
            toast({ title: "Error", description: "Bulk update failed.", variant: "destructive" });
        }
    };

    const handleBulkDelete = async () => {
        if (selectedIds.size === 0) return;
        if (!confirm(`Are you sure you want to delete ${selectedIds.size} selected strategies? This action cannot be undone.`)) {
            return;
        }
        try {
            await Promise.all(
                Array.from(selectedIds).map(id => BacktestCombination.delete(id))
            );
            toast({
                title: "Bulk Delete Successful",
                description: `${selectedIds.size} strategies have been deleted.`,
            });
            await fetchCombinations();
        } catch (error) {
            console.error("Bulk delete failed:", error);
            toast({ title: "Error", description: "Bulk delete failed.", variant: "destructive" });
        }
    };

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-64">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }
    
    return (
        <div className="container mx-auto p-4">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-3xl font-bold">Backtest Strategy Database</h1>
                    <p className="text-muted-foreground mt-1">
                        {combinations.length} {combinations.length === 1 ? 'strategy' : 'strategies'} saved
                    </p>
                </div>
                {selectedIds.size === 0 && (
                    <Button onClick={fetchCombinations}>
                        <Loader2 className="mr-2 h-4 w-4" />
                        Refresh
                    </Button>
                )}
                {selectedIds.size > 0 && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline">
                                Actions ({selectedIds.size})
                                <ChevronDown className="ml-2 h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Bulk Actions</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleBulkUpdate('includedInScanner', true)}>
                                <Zap className="mr-2 h-4 w-4 text-green-500" /> Enable in Demo Scanner
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleBulkUpdate('includedInScanner', false)}>
                                <ZapOff className="mr-2 h-4 w-4 text-red-500" /> Disable in Demo Scanner
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleBulkUpdate('includedInLiveScanner', true)}>
                                <Zap className="mr-2 h-4 w-4 text-blue-500" /> Enable in Live Scanner
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleBulkUpdate('includedInLiveScanner', false)}>
                                <ZapOff className="mr-2 h-4 w-4 text-yellow-500" /> Disable in Live Scanner
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={handleBulkDelete} className="text-red-600 focus:text-red-600 focus:bg-red-50">
                                <Trash2 className="mr-2 h-4 w-4" /> Delete Selected
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>

            <Card className="mb-6">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3 px-4">
                    <CardTitle className="text-sm font-medium">Saved Strategies by Dominant Regime</CardTitle>
                    <Compass className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent className="px-4 pb-3 pt-1">
                    <div className="flex items-center gap-3 flex-wrap">
                        {Object.entries(regimeSummary).sort(([a], [b]) => a.localeCompare(b)).map(([regime, count]) => (
                            <div key={regime} className="flex items-center gap-1.5">
                                <RegimeBadge regime={regime} />
                                <span className="font-semibold text-sm">{count}</span>
                            </div>
                        ))}
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground ml-auto">
                            Total: <span className="font-bold text-primary">{combinations.length}</span>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[50px]">
                                <Checkbox
                                    checked={selectedIds.size > 0 && selectedIds.size === paginatedCombinations.length}
                                    onCheckedChange={handleSelectAll}
                                />
                            </TableHead>
                            <TableHead onClick={() => requestSort('combinationName')} className="cursor-pointer">Name {getSortIcon('combinationName', sortConfig)}</TableHead>
                            <TableHead>Signals</TableHead>
                            <TableHead onClick={() => requestSort('coin')} className="cursor-pointer">Asset {getSortIcon('coin', sortConfig)}</TableHead>
                            <TableHead onClick={() => requestSort('timeframe')} className="cursor-pointer">TF {getSortIcon('timeframe', sortConfig)}</TableHead>
                            <TableHead onClick={() => requestSort('dominantMarketRegime')} className="cursor-pointer">Regime {getSortIcon('dominantMarketRegime', sortConfig)}</TableHead>
                            <TableHead onClick={() => requestSort('profitFactor')} className="cursor-pointer">P/F {getSortIcon('profitFactor', sortConfig)}</TableHead>
                            <TableHead onClick={() => requestSort('successRate')} className="cursor-pointer">Win % {getSortIcon('successRate', sortConfig)}</TableHead>
                            <TableHead onClick={() => requestSort('occurrences')} className="cursor-pointer">Trades {getSortIcon('occurrences', sortConfig)}</TableHead>
                            <TableHead onClick={() => requestSort('combinedStrength')} className="cursor-pointer">Strength {getSortIcon('combinedStrength', sortConfig)}</TableHead>
                            <TableHead onClick={() => requestSort('includedInScanner')} className="cursor-pointer">Demo {getSortIcon('includedInScanner', sortConfig)}</TableHead>
                            <TableHead onClick={() => requestSort('includedInLiveScanner')} className="cursor-pointer">Live {getSortIcon('includedInLiveScanner', sortConfig)}</TableHead>
                            <TableHead>Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {paginatedCombinations.map((combination) => (
                            <TableRow key={combination.id} data-state={selectedIds.has(combination.id) && "selected"}>
                                <TableCell>
                                    <Checkbox
                                        checked={selectedIds.has(combination.id)}
                                        onCheckedChange={(checked) => handleSelectOne(combination.id, checked)}
                                    />
                                </TableCell>
                                <TableCell>
                                    <Link to={createPageUrl(`CombinationStats?id=${combination.id}`)} className="font-medium text-blue-600 hover:underline">
                                        {combination.combinationName || 'Unnamed Strategy'}
                                    </Link>
                                </TableCell>
                                <TableCell>
                                    <div className="flex flex-wrap gap-1">
                                        {(combination.signals || []).slice(0, 3).map((signal, index) => (
                                            <Badge key={index} variant="secondary" className="text-xs">{signal.type}</Badge>
                                        ))}
                                        {(combination.signals || []).length > 3 && (
                                            <Badge variant="outline">+{combination.signals.length - 3}</Badge>
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell>{combination.coin}</TableCell>
                                <TableCell>{combination.timeframe}</TableCell>
                                <TableCell>
                                    <RegimeBadge regime={combination.dominantMarketRegime} />
                                </TableCell>
                                <TableCell>
                                    <ProfitFactorCell value={combination.profitFactor} />
                                </TableCell>
                                <TableCell>
                                    <Badge variant={combination.successRate > 60 ? 'default' : 'destructive'}>
                                        {combination.successRate?.toFixed(1) || 'N/A'}%
                                    </Badge>
                                </TableCell>
                                <TableCell>{combination.occurrences || 0}</TableCell>
                                <TableCell>{combination.combinedStrength?.toFixed(0) || 'N/A'}</TableCell>
                                <TableCell>
                                    <Switch
                                        checked={combination.includedInScanner}
                                        onCheckedChange={(newStatus) => handleToggleScanner(combination.id, newStatus)}
                                        aria-label={`Toggle demo scanner for ${combination.combinationName}`}
                                    />
                                </TableCell>
                                <TableCell>
                                    <Switch
                                        checked={combination.includedInLiveScanner}
                                        onCheckedChange={(newStatus) => handleToggleLiveScanner(combination.id, newStatus)}
                                        aria-label={`Toggle live scanner for ${combination.combinationName}`}
                                    />
                                </TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-1">
                                        <Button variant="outline" size="sm" onClick={() => handleEdit(combination)}>Edit</Button>
                                        <Button variant="ghost" size="icon" onClick={() => handleToggleLiveScanner(combination.id, false)} title="Remove from Live Scanner">
                                            <ZapOff className="h-4 w-4 text-blue-500" />
                                        </Button>
                                        <Button variant="ghost" size="icon" onClick={() => handleOptOut(combination)} title="Opt out from public display">
                                            <ShieldOff className="h-4 w-4 text-yellow-600" />
                                        </Button>
                                        <Button variant="ghost" size="icon" onClick={() => handleDelete(combination.id)} title="Delete combination">
                                            <Trash2 className="h-4 w-4 text-red-600" />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                        {paginatedCombinations.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={13} className="text-center py-8">
                                    <Alert>
                                        <ShieldAlert className="h-4 w-4" />
                                        <AlertTitle>No Combinations Found</AlertTitle>
                                        <AlertDescription>No backtest combinations match your criteria or none are saved yet.</AlertDescription>
                                    </Alert>
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
            />

            {selectedCombination && (
                <>
                    <EditStrategyDialog
                        isOpen={isEditDialogOpen}
                        onClose={() => setIsEditDialogOpen(false)}
                        combination={selectedCombination}
                        onSave={async () => {
                            await fetchCombinations();
                            setIsEditDialogOpen(false);
                        }}
                    />
                    <OptOutDialog
                        isOpen={isOptOutDialogOpen}
                        onClose={() => setIsOptOutDialogOpen(false)}
                        combination={selectedCombination}
                        onConfirm={handleConfirmOptOut}
                    />
                </>
            )}
        </div>
    );
}
