import React from 'react';
import {
  CheckCircle,
  Shield,
  Target,
  Timer,
  User,
  XCircle,
  HelpCircle,
} from 'lucide-react';

const reasonMap = {
    take_profit: { icon: CheckCircle, text: "Take Profit", color: "text-green-500" },
    stop_loss: { icon: Shield, text: "Stop Loss", color: "text-red-500" },
    trailing_stop_hit: { icon: Target, text: "Trailing Stop", color: "text-blue-500" },
    timeout: { icon: Timer, text: "Timeout", color: "text-yellow-600 dark:text-yellow-400" },
    trailing_timeout: { icon: Timer, text: "Trailing Timeout", color: "text-indigo-500 dark:text-indigo-400" },
    manual_close: { icon: User, text: "Manual", color: "text-gray-500 dark:text-gray-400" },
    liquidation: { icon: XCircle, text: "Liquidation", color: "text-red-700" },
    error: { icon: XCircle, text: "Error", color: "text-red-700" },
    cancelled: { icon: XCircle, text: "Cancelled", color: "text-gray-500" },
};

export default function TradeExitReason({ reason }) {
    const details = reasonMap[reason] || { icon: HelpCircle, text: reason || 'Unknown', color: "text-gray-400" };

    return (
        <div className={`flex items-center gap-1.5 text-xs ${details.color}`}>
            <details.icon className="h-3.5 w-3.5" />
            <span className="capitalize whitespace-nowrap">{details.text.replace(/_/g, ' ')}</span>
        </div>
    );
}