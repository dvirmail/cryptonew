import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  TrendingUp, BarChart, Waves, Wind, Mountain, Eye, 
  HelpCircle, Code, List, CheckCircle, XCircle
} from 'lucide-react';

const signalsData = [
  // ... (existing signal data) ...
  {
    name: 'RSI (Relative Strength Index)',
    category: 'Momentum',
    description: 'Measures the speed and change of price movements. Values range from 0 to 100. Typically, values below 30 indicate oversold conditions, and values above 70 indicate overbought conditions.',
    icon: TrendingUp
  },
  {
    name: 'MACD (Moving Average Convergence Divergence)',
    category: 'Trend',
    description: 'A trend-following momentum indicator that shows the relationship between two moving averages of a security’s price. A "Bullish Cross" occurs when the MACD line crosses above the signal line.',
    icon: BarChart
  },
  {
    name: 'Bollinger Bands',
    category: 'Volatility',
    description: 'Bands that envelop the price action. A "Squeeze" indicates low volatility and a potential for a significant future move. Price touching the upper or lower band can indicate overbought or oversold conditions.',
    icon: Waves
  },
  {
    name: 'Volume',
    category: 'Volume',
    description: 'The number of shares or contracts traded. A "Volume Spike" (typically 1.5x-2x the average) indicates strong interest and can confirm a price move.',
    icon: Wind
  },
  {
    name: 'Stochastic Oscillator',
    category: 'Momentum',
    description: 'Compares a particular closing price of a security to a range of its prices over a certain period. Like RSI, it signals overbought (>80) and oversold (<20) conditions.',
    icon: TrendingUp
  },
  {
    name: 'Support & Resistance',
    category: 'Chart Pattern',
    description: 'Identifies price levels where the price has historically reversed. The scanner detects when the current price is "Near" these key levels, suggesting a potential reaction.',
    icon: Mountain
  },
  {
    name: 'Ichimoku Cloud',
    category: 'Trend',
    description: 'A comprehensive indicator that defines support and resistance, identifies trend direction, and provides trading signals. Being "Above Kumo" (the cloud) is bullish; "Below Kumo" is bearish.',
    icon: Eye
  },
  {
    name: 'Candlestick Patterns',
    category: 'Candlestick Pattern',
    description: 'Detects classic candlestick patterns like "Bullish Engulfing", "Doji", or "Hammer". These patterns can signal potential reversals or continuations in price action.',
    icon: BarChart
  }
];

const LogExplanation = () => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <HelpCircle className="text-blue-500" />
        Understanding the Auto-Scanner Logs
      </CardTitle>
      <CardDescription>
        The scanner provides detailed logs for every decision it makes. Here’s how to interpret them.
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-6">
      <div>
        <h3 className="font-semibold text-lg mb-2">Anatomy of a Log Line</h3>
        <p className="mb-4">
          Each signal evaluation in a strategy is logged. Let's break down an example:
        </p>
        <pre className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg text-sm">
          <code>
            <span className="text-red-500 font-bold">❌</span> stochastic: Expected "Overbought" → Got "Neutral" (Strength: 52)
          </code>
        </pre>
        <ul className="list-disc pl-5 mt-4 space-y-2">
          <li><strong className="text-red-500">❌ (Icon):</strong> A red X means the signal's actual state did <span className="font-bold">not match</span> what the strategy required. A green check <strong className="text-green-500">✅</strong> means it was a perfect match.</li>
          <li><strong>stochastic:</strong> The name of the indicator being evaluated.</li>
          <li><strong>Expected "Overbought":</strong> This is the condition the trading strategy was looking for.</li>
          <li><strong>Got "Neutral":</strong> This was the actual, live condition of the indicator at the moment of the scan.</li>
          <li><strong>(Strength: 52):</strong> A calculated score from 0-100 indicating the intensity or confidence of the detected signal ("Neutral" in this case). A higher strength means a more pronounced signal.</li>
        </ul>
      </div>

      <div>
        <h3 className="font-semibold text-lg mb-2">Why Do Some Indicators Have Negative Numbers?</h3>
        <p>
          Some advanced indicators operate on scales that include negative values. This is normal and part of their design.
        </p>
        <ul className="list-disc pl-5 mt-4 space-y-2">
          <li><strong>Williams %R:</strong> Operates on a scale of -100 to 0. Values from -20 to 0 are considered "overbought," and values from -80 to -100 are "oversold."</li>
          <li><strong>CCI (Commodity Channel Index):</strong> Oscillates around zero. Readings above +100 imply overbought conditions, while readings below -100 imply oversold conditions.</li>
          <li><strong>Awesome Oscillator / MACD Histogram:</strong> When the value is positive, it indicates bullish momentum. When it's negative, it indicates bearish momentum. The value crossing from negative to positive is a key bullish signal.</li>
        </ul>
      </div>

      <div>
        <h3 className="font-semibold text-lg mb-2">Final Trade Decisions</h3>
        <p>After evaluating all signals, the scanner makes a final check:</p>
        <pre className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg text-sm mb-2">
          <code>
            <span className="text-yellow-500 font-bold">🚫</span> TRADE BLOCKED: Combined strength (150) below threshold (225)
          </code>
        </pre>
        <p>
          This means that even if some signals matched, the <span className="font-semibold">total combined strength</span> of all signals in the strategy was not high enough to meet the minimum requirement (in this case, 150 was less than the required 225), so the trade was safely blocked.
        </p>
      </div>
    </CardContent>
  </Card>
);

export default function SignalGuidePage() {
  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold">Trading Signal Guide</h1>
        <p className="mt-2 text-lg text-gray-600 dark:text-gray-400">
          An overview of the technical indicators and patterns used by the CryptoSentinel scanner.
        </p>
      </div>

      <LogExplanation />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {signalsData.map((signal) => (
          <Card key={signal.name}>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <signal.icon className="w-6 h-6 text-blue-500" />
                {signal.name}
              </CardTitle>
              <Badge variant="secondary">{signal.category}</Badge>
            </CardHeader>
            <CardContent>
              <p className="text-gray-700 dark:text-gray-300">{signal.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}