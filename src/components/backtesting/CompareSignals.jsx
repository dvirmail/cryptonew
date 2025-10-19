
import React, { useState, useEffect } from "react";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
// Changed ArrowsCompare to GitCompareArrows
import { GitCompareArrows, X, CheckCircle2, XCircle, Layers } from "lucide-react"; 
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";

// Helper to ensure string output
const ensureString = (value, fallback = "") => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

// Helper to format numbers consistently
const formatNumber = (value, decimals = 2) => {
  const num = Number(value);
  return isNaN(num) ? (0).toFixed(decimals) : num.toFixed(decimals);
};

// Function to process signals for display
const processSignals = (signals) => {
  if (!Array.isArray(signals)) return "Unknown";
  return signals.map(s => ensureString(s.type)).join(" + ");
};

const CompareSignals = ({ combinations, currentCoin }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedCombos, setSelectedCombos] = useState([]);
  const [availableCombos, setAvailableCombos] = useState([]);
  const [isComparing, setIsComparing] = useState(false);

  // Initialize available combinations when the component mounts or combinations change
  useEffect(() => {
    if (combinations && combinations.length > 0) {
      // Create a version of combinations with a selected flag and formatted display properties
      const formatted = combinations.map(combo => ({
        ...combo,
        selected: false,
        displayName: processSignals(combo.signals),
        successRateFormatted: formatNumber(combo.successRate),
        occurrencesFormatted: formatNumber(combo.totalCount, 0),
        avgPriceMoveFormatted: formatNumber(combo.avgPriceMove),
        avgMaxDrawdownFormatted: formatNumber(combo.avgMaxDrawdown)
      }));
      setAvailableCombos(formatted);
    } else {
      setAvailableCombos([]);
    }
    // Reset selection when combinations change
    setSelectedCombos([]);
  }, [combinations]);

  // Toggle selection for a combination
  const toggleCombo = (index) => {
    setAvailableCombos(prev => {
      const updated = [...prev];
      updated[index].selected = !updated[index].selected;
      
      // Update the selected combinations list
      const newSelectedCombos = updated.filter(c => c.selected);
      setSelectedCombos(newSelectedCombos);
      
      return updated;
    });
  };

  // Clear all selections
  const clearSelections = () => {
    setAvailableCombos(prev => 
      prev.map(combo => ({ ...combo, selected: false }))
    );
    setSelectedCombos([]);
  };

  // Open the comparison dialog
  const openComparisonDialog = () => {
    if (selectedCombos.length < 2) {
      // Could add a toast notification here
      return;
    }
    setIsComparing(true);
  };

  // Get performance category (good, neutral, poor) based on value
  const getPerformanceCategory = (value, metric) => {
    if (metric === 'successRate') {
      if (value >= 70) return 'good';
      if (value >= 50) return 'neutral';
      return 'poor';
    }
    else if (metric === 'avgPriceMove') {
      if (value >= 2) return 'good';
      if (value >= 1) return 'neutral';
      return 'poor';
    }
    else if (metric === 'avgMaxDrawdown') {
      if (value > -1) return 'good';
      if (value > -3) return 'neutral';
      return 'poor';
    }
    else if (metric === 'occurrences') {
      if (value >= 10) return 'good';
      if (value >= 5) return 'neutral';
      return 'poor';
    }
    return 'neutral';
  };

  // Generate a color class based on performance category
  const getColorClass = (category, isBackground = false) => {
    if (isBackground) {
      if (category === 'good') return 'bg-green-100 dark:bg-green-900/20';
      if (category === 'poor') return 'bg-red-100 dark:bg-red-900/20';
      return 'bg-gray-100 dark:bg-gray-800';
    } else {
      if (category === 'good') return 'text-green-600 dark:text-green-400';
      if (category === 'poor') return 'text-red-600 dark:text-red-400';
      return 'text-gray-600 dark:text-gray-400';
    }
  };

  return (
    <>
      <Button 
        variant="outline" 
        className="gap-2"
        onClick={() => setIsOpen(true)}
      >
        {/* Changed ArrowsCompare to GitCompareArrows */}
        <GitCompareArrows className="h-4 w-4" /> 
        Compare Signals
      </Button>

      {/* Selection Dialog */}
      <Dialog open={isOpen && !isComparing} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Compare Signal Combinations</DialogTitle>
            <DialogDescription>
              Select 2 or more signal combinations to compare their performance.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between my-2">
            <div className="text-sm">
              {selectedCombos.length} combinations selected
            </div>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={clearSelections}
              disabled={selectedCombos.length === 0}
            >
              Clear All
            </Button>
          </div>

          <ScrollArea className="flex-grow pr-4 border rounded-md max-h-[50vh]">
            <div className="p-4 space-y-2">
              {availableCombos.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  No signal combinations available to compare.
                </div>
              ) : (
                availableCombos.map((combo, index) => (
                  <div 
                    key={index}
                    className={`flex items-center space-x-2 p-3 rounded-md transition-colors ${
                      combo.selected ? 'bg-primary/10 border border-primary/30' : 'hover:bg-accent'
                    }`}
                  >
                    <Checkbox 
                      checked={combo.selected}
                      onCheckedChange={() => toggleCombo(index)}
                      id={`combo-${index}`}
                    />
                    <div className="flex-grow">
                      <label 
                        htmlFor={`combo-${index}`}
                        className="flex flex-col cursor-pointer"
                      >
                        <span className="font-medium">{combo.displayName}</span>
                        <div className="flex flex-wrap gap-2 mt-1">
                          <Badge variant="outline">
                            {combo.successRateFormatted}% Success
                          </Badge>
                          <Badge variant="outline" className="bg-background">
                            {combo.occurrencesFormatted} Occurrences
                          </Badge>
                        </div>
                      </label>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={openComparisonDialog} 
              disabled={selectedCombos.length < 2}
            >
              Compare {selectedCombos.length} Combinations
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Comparison Results Dialog */}
      <Dialog open={isComparing} onOpenChange={setIsComparing}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {/* Changed ArrowsCompare to GitCompareArrows */}
              <GitCompareArrows className="h-5 w-5" /> 
              Signal Comparison: {currentCoin}
            </DialogTitle>
            <DialogDescription>
              Comparing {selectedCombos.length} signal combinations
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <ScrollArea className="border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead className="w-[250px]">Signal Combination</TableHead>
                    <TableHead>Success Rate</TableHead>
                    <TableHead>Occurrences</TableHead>
                    <TableHead>Avg. Price Move</TableHead>
                    <TableHead>Max Drawdown</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedCombos.map((combo, index) => {
                    const successRateCategory = getPerformanceCategory(combo.successRate, 'successRate');
                    const priceMoveCategory = getPerformanceCategory(combo.avgPriceMove, 'avgPriceMove');
                    const drawdownCategory = getPerformanceCategory(combo.avgMaxDrawdown, 'avgMaxDrawdown');
                    const occurrencesCategory = getPerformanceCategory(combo.totalCount, 'occurrences');
                    
                    return (
                      <TableRow key={index} className="relative">
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <Layers className="h-4 w-4 text-primary" />
                            {combo.displayName}
                          </div>
                        </TableCell>
                        <TableCell className={`font-medium ${getColorClass(successRateCategory)}`}>
                          {combo.successRateFormatted}%
                          <div className="mt-1">
                            {successRateCategory === 'good' ? (
                              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Good
                              </Badge>
                            ) : successRateCategory === 'poor' ? (
                              <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                                <XCircle className="h-3 w-3 mr-1" />
                                Poor
                              </Badge>
                            ) : (
                              <Badge variant="outline">Neutral</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className={getColorClass(occurrencesCategory)}>
                          {combo.occurrencesFormatted}
                        </TableCell>
                        <TableCell className={getColorClass(priceMoveCategory)}>
                          {combo.avgPriceMoveFormatted}%
                        </TableCell>
                        <TableCell className={getColorClass(drawdownCategory)}>
                          {combo.avgMaxDrawdownFormatted}%
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setIsComparing(false);
              setIsOpen(true);
            }}>
              Back to Selection
            </Button>
            <Button variant="default" onClick={() => {
              setIsComparing(false);
              setIsOpen(false);
            }}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default CompareSignals;
