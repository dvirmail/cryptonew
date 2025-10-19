import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Calculator, AlertTriangle, CheckCircle, Info } from 'lucide-react';
import { validatePositionSize, analyzePositionRisk } from '@/components/utils/positionSizeValidator';

export default function PositionSizeDebugger({ position, walletBalance }) {
  const [validation, setValidation] = useState(null);
  const [portfolioAnalysis, setPortfolioAnalysis] = useState(null);

  useEffect(() => {
    if (position && walletBalance) {
      // For demo purposes, assume ATR value (in real app, fetch from indicators)
      const estimatedATR = Math.abs(position.entry_price - position.stop_loss_price) / 2.5; // Reverse engineer ATR
      const validationResult = validatePositionSize(position, walletBalance, estimatedATR);
      setValidation(validationResult);
      
      const portfolioResult = analyzePositionRisk([position], walletBalance);
      setPortfolioAnalysis(portfolioResult);
    }
  }, [position, walletBalance]);

  if (!validation) return null;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="h-5 w-5" />
          Position Size Analysis: {position.symbol}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Position Details */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Position Size</p>
            <p className="text-lg font-semibold">${validation.positionSize}</p>
            <p className="text-xs text-muted-foreground">{validation.positionPercent}% of wallet</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Actual Risk</p>
            <p className="text-lg font-semibold">${validation.actualRisk}</p>
            <p className="text-xs text-muted-foreground">{validation.riskPercent}% of wallet</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Stop Loss Distance</p>
            <p className="text-lg font-semibold">{validation.stopLossPercent}%</p>
            <p className="text-xs text-muted-foreground">${validation.stopLossDistance}</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">ATR Value</p>
            <p className="text-lg font-semibold">{validation.atrPercent}%</p>
            <p className="text-xs text-muted-foreground">${validation.atrValue}</p>
          </div>
        </div>

        {/* Validation Results */}
        <div className="space-y-3">
          <h4 className="font-semibold">Validation Results</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex items-center gap-2">
              {validation.validation.riskWithinLimits ? 
                <CheckCircle className="h-4 w-4 text-green-500" /> : 
                <AlertTriangle className="h-4 w-4 text-red-500" />
              }
              <span className="text-sm">Risk within limits (≤3%)</span>
              <Badge variant={validation.validation.riskWithinLimits ? "default" : "destructive"}>
                {validation.riskPercent}%
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              {validation.validation.positionSizeReasonable ? 
                <CheckCircle className="h-4 w-4 text-green-500" /> : 
                <AlertTriangle className="h-4 w-4 text-red-500" />
              }
              <span className="text-sm">Position size reasonable (≤70%)</span>
              <Badge variant={validation.validation.positionSizeReasonable ? "default" : "destructive"}>
                {validation.positionPercent}%
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              {validation.validation.stopLossReasonable ? 
                <CheckCircle className="h-4 w-4 text-green-500" /> : 
                <AlertTriangle className="h-4 w-4 text-red-500" />
              }
              <span className="text-sm">Stop loss reasonable (≤5%)</span>
              <Badge variant={validation.validation.stopLossReasonable ? "default" : "destructive"}>
                {validation.stopLossPercent}%
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-blue-500" />
              <span className="text-sm">ATR-based sizing</span>
              <Badge variant="outline">Active</Badge>
            </div>
          </div>
        </div>

        {/* Calculation Formula */}
        <Alert>
          <Calculator className="h-4 w-4" />
          <AlertDescription>
            <strong>Position Size Formula:</strong><br />
            Risk Amount ($200) ÷ Stop Loss Distance (${validation.stopLossDistance}) = Position Size (${validation.positionSize})
            <br /><br />
            <strong>ATR Multiplier Test:</strong> Your current 2.5x ATR multiplier creates a {validation.stopLossPercent}% stop loss. 
            Consider testing 1.5x-3.5x range to find optimal balance between risk and noise.
          </AlertDescription>
        </Alert>

        {/* Portfolio Analysis */}
        {portfolioAnalysis && (
          <div className="space-y-2">
            <h4 className="font-semibold">Portfolio Impact</h4>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Total Risk</p>
                <p className="font-semibold">{portfolioAnalysis.totalRiskPercent}%</p>
              </div>
              <div>
                <p className="text-muted-foreground">Portfolio Utilization</p>
                <p className="font-semibold">{portfolioAnalysis.portfolioUtilization}%</p>
              </div>
              <div>
                <p className="text-muted-foreground">Available Balance</p>
                <p className="font-semibold">${portfolioAnalysis.availableBalance}</p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}