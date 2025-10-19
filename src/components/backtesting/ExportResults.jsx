
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { 
  DropdownMenu, 
  DropdownMenuTrigger, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuSeparator 
} from "@/components/ui/dropdown-menu";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription, 
  DialogFooter 
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Download, FileJson, FileSpreadsheet, Check, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/components/ui/use-toast";

const ExportResults = ({ combinations, backtestResults, timeframe }) => {
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState("csv");
  const [exportOptions, setExportOptions] = useState({
    includeMetadata: true,
    includeIndividualMatches: true,
    includeSignalParameters: true,
  });
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();

  // Prepare backtest metadata
  const prepareMetadata = () => {
    return {
      exportDate: new Date().toISOString(),
      coinsTested: backtestResults?.coinsTested || (combinations && combinations.length > 0 ? Array.from(new Set(combinations.map(c => c.coin))).join(', ') : "N/A"),
      timeframe: timeframe,
      totalCombinationsTested: combinations.length,
      successfulCombinations: combinations.filter(c => c.successRate > 50).length, // Example criteria
      totalSignalMatches: combinations.reduce((acc, c) => acc + (c.totalCount || 0), 0),
      totalSuccessfulMatches: combinations.reduce((acc, c) => {
        const successCount = c.totalCount * (c.successRate / 100);
        return acc + Math.round(successCount);
      }, 0),
      overallSuccessRate: backtestResults?.successRate || 0,
      averageNetPriceMoveAll: backtestResults?.netAverageGainAllTrades || 0,
    };
  };

  // Prepare data for export
  const prepareExportData = () => {
    const metadata = prepareMetadata();
    
    // Format combinations for export
    const formattedCombinations = combinations.map(combo => {
      const result = {
        coin: combo.coin, // Include coin
        timeframe: timeframe,
        signals: combo.signals.map(s => s.type).join("+"),
        successRate: combo.successRate,
        occurrences: combo.totalCount,
        avgPriceMove: combo.netAveragePriceMove,
        avgMaxDrawdown: combo.avgMaxDrawdown,
        avgTimeToPeak: combo.avgTimeToPeak,
      };
      
      // Add signal parameters if requested
      if (exportOptions.includeSignalParameters) {
        combo.signals.forEach((signal, idx) => {
          result[`signal${idx+1}_type`] = signal.type;
          if (signal.parameters) {
            Object.entries(signal.parameters).forEach(([paramKey, paramValue]) => {
              result[`signal${idx+1}_${paramKey}`] = paramValue;
            });
          }
        });
      }
      
      // Add individual matches if requested
      if (exportOptions.includeIndividualMatches && combo.matches && combo.matches.length > 0) {
        result.individualMatches = combo.matches.map(match => ({
          date: match.time ? new Date(match.time).toISOString() : 'N/A',
          price: match.price,
          successful: match.successful,
          priceMove: match.priceMove,
          maxDrawdown: match.maxDrawdown,
          timeToPeak: match.timeToPeak,
        }));
      }
      
      return result;
    });
    
    return {
      metadata: exportOptions.includeMetadata ? metadata : null,
      combinations: formattedCombinations
    };
  };

  // Convert data to CSV format
  const convertToCSV = (data) => {
    let csv = '';
    const combinationRows = [];
    const matchRows = [];
    
    // Add metadata as comments at the top
    if (data.metadata) {
      csv += `# Backtest Export - ${format(new Date(), "yyyy-MM-dd HH:mm:ss")}\n`;
      csv += `# Coins Tested: ${data.metadata.coinsTested}\n`;
      csv += `# Timeframe: ${data.metadata.timeframe}\n`;
      csv += `# Overall Success Rate: ${data.metadata.overallSuccessRate.toFixed(2)}%\n`;
      csv += `# Total Combinations Found: ${data.metadata.totalCombinationsTested}\n`;
      csv += `# Total Raw Signal Events: ${data.metadata.totalSignalMatches}\n\n`;
    }
    
    // Get all possible headers for combinations
    const combinationHeaders = new Set();
    data.combinations.forEach(combo => {
      Object.keys(combo).forEach(key => {
        if (key !== 'individualMatches') {
          combinationHeaders.add(key);
        }
      });
    });
    
    // Convert headers set to array
    const headerArr = Array.from(combinationHeaders);
    
    // Add headers row
    csv += headerArr.join(',') + '\n';
    
    // Add data rows
    data.combinations.forEach(combo => {
      const row = headerArr.map(header => {
        const value = combo[header];
        // Format the value for CSV
        if (value === undefined || value === null) return '';
        if (typeof value === 'string') return `"${value.replace(/"/g, '""')}"`;
        return value;
      }).join(',');
      
      combinationRows.push(row);
      
      // If including individual matches, add them in a separate section
      if (exportOptions.includeIndividualMatches && combo.individualMatches && combo.individualMatches.length > 0) {
        matchRows.push(`\n# Individual Matches for ${combo.signals} on ${combo.coin}`);
        
        // Get headers for matches
        const matchHeaders = Object.keys(combo.individualMatches[0]);
        matchRows.push(matchHeaders.join(','));
        
        // Add match rows
        combo.individualMatches.forEach(match => {
          const matchRow = matchHeaders.map(header => {
            const value = match[header];
            if (value === undefined || value === null) return '';
            if (typeof value === 'string') return `"${value.replace(/"/g, '""')}"`;
            return value;
          }).join(',');
          
          matchRows.push(matchRow);
        });
      }
    });
    
    csv += combinationRows.join('\n');
    
    if (matchRows.length > 0) {
      csv += '\n\n' + matchRows.join('\n');
    }
    
    return csv;
  };

  // Download the exported data
  const downloadExport = (data, filename) => {
    const blob = new Blob([data], { type: exportFormat === 'json' ? 'application/json' : 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Handle the export action
  const handleExport = async () => {
    if (!combinations || combinations.length === 0) {
      toast({
        title: "No data to export",
        description: "Please run a backtest first to generate results.",
        variant: "destructive"
      });
      return;
    }
    
    setIsExporting(true);
    
    try {
      // Prepare the data
      const exportData = prepareExportData();
      
      // Format based on selected export type
      let formattedData;
      let filename;
      const dateSuffix = format(new Date(), "yyyyMMdd_HHmmss");
      const coinsString = backtestResults?.coinsTested?.split(',').join('_').replace(/\//g, '') || "multi_coin";

      if (exportFormat === 'json') {
        formattedData = JSON.stringify(exportData, null, 2);
        filename = `backtest_${coinsString}_${timeframe}_${dateSuffix}.json`;
      } else {
        formattedData = convertToCSV(exportData);
        filename = `backtest_${coinsString}_${timeframe}_${dateSuffix}.csv`;
      }
      
      // Download the file
      downloadExport(formattedData, filename);
      
      toast({
        title: "Export Successful",
        description: `Your backtest results have been exported as ${exportFormat.toUpperCase()}.`,
      });
      
      // Close the dialog
      setExportDialogOpen(false);
    } catch (error) {
      console.error("Export error:", error);
      toast({
        title: "Export Failed",
        description: "An error occurred while exporting the data.",
        variant: "destructive"
      });
    } finally {
      setIsExporting(false);
    }
  };

  // Toggle an export option
  const toggleOption = (option) => {
    setExportOptions(prev => ({
      ...prev,
      [option]: !prev[option]
    }));
  };

  const openExportDialog = (format) => {
    setExportFormat(format);
    setExportDialogOpen(true);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button 
            variant="outline" 
            className="w-full gap-2"
            disabled={!combinations || combinations.length === 0}
          >
            <Download className="h-4 w-4" />
            Export Results
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => openExportDialog("csv")}>
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            CSV Format
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openExportDialog("json")}>
            <FileJson className="mr-2 h-4 w-4" />
            JSON Format
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export Backtest Results</DialogTitle>
            <DialogDescription>
              Customize what data to include in your {exportFormat.toUpperCase()} export.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="include-metadata" 
                  checked={exportOptions.includeMetadata}
                  onCheckedChange={() => toggleOption('includeMetadata')}
                />
                <Label htmlFor="include-metadata" className="text-sm font-medium">
                  Include Backtest Metadata
                </Label>
              </div>
              <p className="text-xs text-muted-foreground pl-6">
                Includes backtest date, coins, timeframe, and summary statistics.
              </p>
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="include-parameters" 
                  checked={exportOptions.includeSignalParameters}
                  onCheckedChange={() => toggleOption('includeSignalParameters')}
                />
                <Label htmlFor="include-parameters" className="text-sm font-medium">
                  Include Signal Parameters
                </Label>
              </div>
              <p className="text-xs text-muted-foreground pl-6">
                Includes detailed parameters for each signal (periods, thresholds).
              </p>
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="include-matches" 
                  checked={exportOptions.includeIndividualMatches}
                  onCheckedChange={() => toggleOption('includeIndividualMatches')}
                />
                <Label htmlFor="include-matches" className="text-sm font-medium">
                  Include Individual Signal Matches
                </Label>
              </div>
              <p className="text-xs text-muted-foreground pl-6">
                Includes individual occurrence details for each signal combination.
              </p>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleExport} disabled={isExporting} className="gap-2">
              {isExporting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Export as {exportFormat.toUpperCase()}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ExportResults;
