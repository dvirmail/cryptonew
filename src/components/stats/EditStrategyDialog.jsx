
import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lightbulb, TrendingUp, TrendingDown, Scale, AlertTriangle, Target, Settings } from 'lucide-react';
import { BacktestCombination } from "@/api/entities";
import { useToast } from "@/components/ui/use-toast";
import { Checkbox } from "@/components/ui/checkbox"; // New import for Checkbox

const EditStrategyDialog = ({ combination, isOpen, onClose, onSave }) => {
  const [formData, setFormData] = useState({
    combinationName: '', // New field from outline
    takeProfitPercentage: '',
    stopLossPercentage: '',
    positionSizePercentage: '',
    estimatedExitTimeMinutes: '',
    enableTrailingTakeProfit: false, // New field from outline
    trailingStopPercentage: '', // New field from outline
  });
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (combination) {
      setFormData({
        combinationName: combination.combinationName || '', // Initialize combinationName
        takeProfitPercentage: combination.takeProfitPercentage || '',
        stopLossPercentage: combination.stopLossPercentage || '',
        positionSizePercentage: combination.positionSizePercentage || '',
        estimatedExitTimeMinutes: combination.estimatedExitTimeMinutes || '',
        enableTrailingTakeProfit: combination.enableTrailingTakeProfit || false, // Initialize enableTrailingTakeProfit
        trailingStopPercentage: combination.trailingStopPercentage || '', // Initialize trailingStopPercentage
      });
    }
  }, [combination]);

  const recommendations = useMemo(() => {
    if (!combination || combination.realTradeCount === undefined) return [];
    
    const recs = [];
    
    // Use REAL data for recommendations and compare with backtest data
    const { 
      realSuccessRate, 
      realAvgPnlPercent, 
      realTradeCount, 
      successRate: backtestSuccessRate,
      avgPriceMove: backtestAvgPnl,
      takeProfitPercentage, 
      stopLossPercentage, 
      positionSizePercentage 
    } = combination;

    // Calculate performance gap
    const successRateGap = realSuccessRate - backtestSuccessRate;
    const pnlGap = realAvgPnlPercent - backtestAvgPnl;

    if (realTradeCount > 5) { // Only give advice if there's enough real data
      
      // Address backtest vs reality discrepancy first
      if (Math.abs(successRateGap) > 10) {
        if (successRateGap < -10) {
          recs.push({
            icon: AlertTriangle,
            color: 'text-orange-500',
            bgColor: 'bg-orange-50 dark:bg-orange-900/20',
            borderColor: 'border-orange-200 dark:border-orange-800',
            title: 'Underperforming vs Backtest',
            description: `Real success rate (${realSuccessRate.toFixed(1)}%) is ${Math.abs(successRateGap).toFixed(1)}% lower than backtest (${backtestSuccessRate.toFixed(1)}%). This could indicate overfitting in backtest or changing market conditions. Consider reducing position size until performance stabilizes.`
          });
        } else {
          recs.push({
            icon: Target,
            color: 'text-green-500',
            bgColor: 'bg-green-50 dark:bg-green-900/20',
            borderColor: 'border-green-200 dark:border-green-800',
            title: 'Outperforming Backtest',
            description: `Real success rate (${realSuccessRate.toFixed(1)}%) is ${successRateGap.toFixed(1)}% higher than backtest (${backtestSuccessRate.toFixed(1)}%). This suggests the strategy is adapting well to current market conditions.`
          });
        }
      }

      // Address P&L performance gap
      if (Math.abs(pnlGap) > 1) {
        if (pnlGap < -1) {
          recs.push({
            icon: TrendingDown,
            color: 'text-red-500',
            bgColor: 'bg-red-50 dark:bg-red-900/20',
            borderColor: 'border-red-200 dark:border-red-800',
            title: 'Lower Profit Margins Than Expected',
            description: `Real avg P&L (${realAvgPnlPercent.toFixed(2)}%) is ${Math.abs(pnlGap).toFixed(2)}% lower than backtest (${backtestAvgPnl.toFixed(2)}%). Consider tightening entry criteria or adjusting stop-loss to preserve capital.`
          });
        }
      }

      // Traditional recommendations based on real performance
      if (realSuccessRate > 70 && realAvgPnlPercent > (takeProfitPercentage || 0)) {
        recs.push({
          icon: TrendingUp,
          color: 'text-green-500',
          bgColor: 'bg-green-50 dark:bg-green-900/20',
          borderColor: 'border-green-200 dark:border-green-800',
          title: 'Consider Increasing Take Profit',
          description: `With a real success rate of ${realSuccessRate.toFixed(1)}% and average P&L of ${realAvgPnlPercent.toFixed(2)}%, you might capture more profit by increasing your TP target.`
        });
      }
      
      if (realSuccessRate < 50) {
        recs.push({
          icon: TrendingDown,
          color: 'text-red-500',
          bgColor: 'bg-red-50 dark:bg-red-900/20',
          borderColor: 'border-red-200 dark:border-red-800',
          title: 'Consider Tightening Stop Loss',
          description: `The real success rate is low at ${realSuccessRate.toFixed(1)}%. A tighter SL could reduce the impact of losing trades and improve the risk/reward ratio.`
        });
      }
      
      if (realTradeCount > 10 && realSuccessRate > 65 && successRateGap > -5) {
        recs.push({
          icon: Scale,
          color: 'text-blue-500',
          bgColor: 'bg-blue-50 dark:bg-blue-900/20',
          borderColor: 'border-blue-200 dark:border-blue-800',
          title: 'Consider Higher Position Size',
          description: `This has proven reliable over ${realTradeCount} trades with a ${realSuccessRate.toFixed(1)}% win rate. Since it's not significantly underperforming vs backtest, you could consider a slightly larger position size.`
        });
      }
    }

    if (recs.length === 0) {
      recs.push({
        icon: Lightbulb,
        color: 'text-yellow-500',
        bgColor: 'bg-yellow-50 dark:bg-yellow-900/20',
        borderColor: 'border-yellow-200 dark:border-yellow-800',
        title: realTradeCount > 0 ? 'Strategy is Performing as Expected' : 'No Real Trade Data Yet',
        description: realTradeCount > 0 
          ? `Based on ${realTradeCount} real trades, the current parameters seem balanced. Real performance (${realSuccessRate.toFixed(1)}% success rate) is close to backtest expectations (${backtestSuccessRate.toFixed(1)}%).`
          : 'This strategy has not yet executed any trades. Recommendations will appear here once it has a live performance history.'
      });
    }
    
    return recs;
  }, [combination]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleCheckboxChange = (checked) => {
    setFormData(prev => ({
      ...prev,
      enableTrailingTakeProfit: checked
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updatedData = {
        combinationName: formData.combinationName || null, // Include new field
        takeProfitPercentage: parseFloat(formData.takeProfitPercentage) || null,
        stopLossPercentage: parseFloat(formData.stopLossPercentage) || null,
        positionSizePercentage: parseFloat(formData.positionSizePercentage) || null,
        estimatedExitTimeMinutes: parseInt(formData.estimatedExitTimeMinutes, 10) || null,
        enableTrailingTakeProfit: formData.enableTrailingTakeProfit, // Include new field
        // trailingStopPercentage is only saved if enableTrailingTakeProfit is true
        trailingStopPercentage: formData.enableTrailingTakeProfit ? (parseFloat(formData.trailingStopPercentage) || null) : null, 
      };

      const updatedCombination = await BacktestCombination.update(combination.id, updatedData);
      onSave(updatedCombination);
      toast({
        title: "Strategy Updated",
        description: "Your changes have been saved successfully.",
      });
    } catch (error) {
      console.error("Failed to save strategy:", error);
      toast({
        title: "Error",
        description: "Could not save strategy changes. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };
  
  if (!isOpen || !combination) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="pb-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <Settings className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <DialogTitle className="text-2xl font-bold text-gray-900 dark:text-white">
                {combination.combinationName} {/* Display original name in header */}
              </DialogTitle>
              <DialogDescription className="text-base text-gray-600 dark:text-gray-400 mt-1">
                Fine-tune parameters and review AI-powered optimization recommendations
              </DialogDescription>
              <div className="flex gap-2 mt-3">
                <Badge variant="outline" className="text-xs">
                  {combination.coin} • {combination.timeframe}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {combination.realTradeCount || 0} Real Trades
                </Badge>
              </div>
            </div>
          </div>
        </DialogHeader>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 py-6">
          {/* Parameters Section */}
          <div className="space-y-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded-lg">
                <Settings className="h-5 w-5 text-gray-600 dark:text-gray-400" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white">Trading Parameters</h3>
            </div>
            
            <div className="space-y-6">
              {/* New: Combination Name Input */}
              <div className="space-y-2">
                <Label htmlFor="combinationName" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Strategy Name
                </Label>
                <Input 
                  id="combinationName" 
                  name="combinationName" 
                  type="text" 
                  value={formData.combinationName} 
                  onChange={handleInputChange} 
                  placeholder="e.g., My Awesome Strategy v2" 
                  className="h-11 text-base"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  A descriptive name for this strategy combination
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="takeProfitPercentage" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Take Profit Percentage
                </Label>
                <Input 
                  id="takeProfitPercentage" 
                  name="takeProfitPercentage" 
                  type="number" 
                  step="0.1"
                  value={formData.takeProfitPercentage} 
                  onChange={handleInputChange} 
                  placeholder="e.g., 3.5" 
                  className="h-11 text-base"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Profit target as percentage of entry price
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="stopLossPercentage" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Stop Loss Percentage
                </Label>
                <Input 
                  id="stopLossPercentage" 
                  name="stopLossPercentage" 
                  type="number" 
                  step="0.1"
                  value={formData.stopLossPercentage} 
                  onChange={handleInputChange} 
                  placeholder="e.g., 1.5" 
                  className="h-11 text-base"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Maximum loss as percentage of entry price
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="positionSizePercentage" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Position Size (% of Wallet)
                </Label>
                <Input 
                  id="positionSizePercentage" 
                  name="positionSizePercentage" 
                  type="number" 
                  step="0.1"
                  value={formData.positionSizePercentage} 
                  onChange={handleInputChange} 
                  placeholder="e.g., 5" 
                  className="h-11 text-base"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Percentage of total wallet balance to risk per trade
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="estimatedExitTimeMinutes" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Time-based Exit (minutes)
                </Label>
                <Input 
                  id="estimatedExitTimeMinutes" 
                  name="estimatedExitTimeMinutes" 
                  type="number" 
                  value={formData.estimatedExitTimeMinutes} 
                  onChange={handleInputChange} 
                  placeholder="e.g., 120" 
                  className="h-11 text-base"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Auto-close position after specified time (optional)
                </p>
              </div>

              {/* Fixed: Enable Trailing Take Profit Checkbox */}
              <div className="flex items-center space-x-2 pt-4">
                <Checkbox 
                  id="enableTrailingTakeProfit" 
                  checked={formData.enableTrailingTakeProfit || false} // Ensure it's always a boolean
                  onCheckedChange={handleCheckboxChange} 
                />
                <Label htmlFor="enableTrailingTakeProfit" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Enable Trailing Take Profit
                </Label>
              </div>
              {/* New: Trailing Stop Percentage Input (conditional) */}
              {formData.enableTrailingTakeProfit && (
                <div className="space-y-2 pl-6">
                  <Label htmlFor="trailingStopPercentage" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Trailing Stop Percentage
                  </Label>
                  <Input 
                    id="trailingStopPercentage" 
                    name="trailingStopPercentage" 
                    type="number" 
                    step="0.1"
                    value={formData.trailingStopPercentage} 
                    onChange={handleInputChange} 
                    placeholder="e.g., 0.5" 
                    className="h-11 text-base"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Percentage price move against trade before trailing stop is hit
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* AI Recommendations Section */}
          <div className="space-y-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
                <Lightbulb className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white">AI Recommendations</h3>
            </div>
            
            <div className="space-y-4">
              {recommendations.map((rec, index) => (
                <div 
                  key={index} 
                  className={`p-5 rounded-xl border-2 ${rec.bgColor} ${rec.borderColor} transition-all hover:shadow-md`}
                >
                  <div className="flex items-start gap-4">
                    <div className={`p-2 rounded-lg bg-white dark:bg-gray-800 shadow-sm`}>
                      <rec.icon className={`h-5 w-5 ${rec.color}`} />
                    </div>
                    <div className="flex-1 space-y-2">
                      <h4 className="font-semibold text-lg text-gray-900 dark:text-white leading-tight">
                        {rec.title}
                      </h4>
                      <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                        {rec.description}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        
        <DialogFooter className="pt-6 border-t border-gray-200 dark:border-gray-700">
          <div className="flex gap-3 w-full sm:w-auto">
            <Button 
              variant="outline" 
              onClick={onClose} 
              disabled={isSaving}
              className="flex-1 sm:flex-none h-11 px-6"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleSave} 
              disabled={isSaving}
              className="flex-1 sm:flex-none h-11 px-6 bg-blue-600 hover:bg-blue-700"
            >
              {isSaving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
};

export default EditStrategyDialog;
