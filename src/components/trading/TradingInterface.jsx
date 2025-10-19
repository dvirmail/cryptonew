
import React, { useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const SUPPORTED_PAIRS = [
  { symbol: "BTC/USDT", name: "Bitcoin", price: 28500 },
  { symbol: "ETH/USDT", name: "Ethereum", price: 1650 },
  { symbol: "ALGO/USDT", name: "Algorand", price: 0.32 },
  { symbol: "KDA/USDT", name: "Kadena", price: 0.60 }
];

export default function TradingInterface({ onExecuteTrade, selectedPairSymbol }) {
  const [selectedPair, setSelectedPair] = React.useState(SUPPORTED_PAIRS[0]);
  const [amount, setAmount] = React.useState("");
  const [leverage, setLeverage] = React.useState("1");

  // Update selected pair when prop changes or if current selectedPair is removed
  useEffect(() => {
    const currentSelectedIsValid = SUPPORTED_PAIRS.some(p => p.symbol === selectedPair.symbol);
    
    if (selectedPairSymbol && SUPPORTED_PAIRS.some(p => p.symbol === selectedPairSymbol)) {
      const pair = SUPPORTED_PAIRS.find(p => p.symbol === selectedPairSymbol);
      if (pair) {
        setSelectedPair(pair);
      }
    } else if (!currentSelectedIsValid && SUPPORTED_PAIRS.length > 0) {
        // If current selectedPair got removed (e.g. MATIC), default to first available
        setSelectedPair(SUPPORTED_PAIRS[0]);
    } else if (SUPPORTED_PAIRS.length === 0) {
        // Handle case where all pairs might be removed, though unlikely
        setSelectedPair({ symbol: "N/A", name: "No Pairs", price: 0});
    }
  }, [selectedPairSymbol, selectedPair.symbol]); // Add selectedPair.symbol to deps

  return (
    <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
      <CardHeader>
        <CardTitle className="text-gray-800 dark:text-white">Manual Trade</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm text-gray-600 dark:text-gray-400">Select Pair</label>
          <Select 
            value={selectedPair.symbol}
            onValueChange={(value) => setSelectedPair(SUPPORTED_PAIRS.find(p => p.symbol === value))}
          >
            <SelectTrigger className="w-full bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
              <SelectValue placeholder="Select trading pair" />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_PAIRS.map((pair) => (
                <SelectItem key={pair.symbol} value={pair.symbol}>
                  <div className="flex items-center justify-between w-full">
                    <span>{pair.symbol}</span>
                    <span className="text-gray-500">${pair.price}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-sm text-gray-600 dark:text-gray-400">Amount</label>
          <Input
            type="number"
            placeholder="Enter amount..."
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm text-gray-600 dark:text-gray-400">Leverage</label>
          <Select value={leverage} onValueChange={setLeverage}>
            <SelectTrigger className="w-full bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
              <SelectValue placeholder="Select leverage" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1x</SelectItem>
              <SelectItem value="2">2x</SelectItem>
              <SelectItem value="5">5x</SelectItem>
              <SelectItem value="10">10x</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="pt-4">
          <Button 
            className="w-full bg-green-600 hover:bg-green-700 text-base py-6"
            onClick={() => onExecuteTrade('buy', selectedPair, amount, leverage)}
            disabled={!amount || parseFloat(amount) <= 0}
          >
            Execute Buy / Long
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
