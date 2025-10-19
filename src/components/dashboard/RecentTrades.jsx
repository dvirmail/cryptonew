import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, ArrowDownRight, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function RecentTrades({ trades = [] }) {
  // UPDATED: Safe formatting functions to prevent errors
  const formatCurrency = (value) => {
    const numValue = Number(value || 0);
    if (isNaN(numValue)) return '$0.00';
    return numValue.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  };
  
  const safeToFixed = (value, decimals = 2) => {
    const numValue = Number(value || 0);
    if (isNaN(numValue)) return (0).toFixed(decimals);
    return numValue.toFixed(decimals);
  };

  // UPDATED: Safe date formatting to prevent Invalid Date errors
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'Invalid Date';
      return format(date, "MMM dd, yyyy HH:mm");
    } catch (error) {
      console.warn('Date formatting error:', error, 'for date:', dateString);
      return 'Invalid Date';
    }
  };

  const renderTooltipContent = (trade) => {
    return (
      <div className="p-2 space-y-1 text-xs">
        <div><strong>Entry:</strong> {formatDate(trade.entry_timestamp)}</div>
        <div><strong>Exit:</strong> {formatDate(trade.exit_timestamp)}</div>
        <div><strong>Duration:</strong> {trade.duration_seconds ? `${Math.floor((trade.duration_seconds || 0) / 60)} min` : 'N/A'}</div>
        <div><strong>Strategy:</strong> {trade.strategy_name || 'N/A'}</div>
      </div>
    );
  };

  return (
    <Card className="col-span-1 lg:col-span-2 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
      <CardHeader>
        <CardTitle className="text-lg font-semibold text-gray-900 dark:text-white">Recent Trades</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="border-b-gray-200 dark:border-b-gray-700">
              <TableHead className="text-gray-700 dark:text-gray-300">Pair</TableHead>
              <TableHead className="text-gray-700 dark:text-gray-300">Direction</TableHead>
              <TableHead className="text-gray-700 dark:text-gray-300">Entry</TableHead>
              <TableHead className="text-gray-700 dark:text-gray-300">Exit</TableHead>
              <TableHead className="text-gray-700 dark:text-gray-300">P&L</TableHead>
              <TableHead className="text-right text-gray-700 dark:text-gray-300">Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trades.map((trade) => (
              <TableRow key={trade.id || trade.trade_id} className="border-b-gray-200 dark:border-b-gray-700">
                <TableCell className="font-medium text-gray-900 dark:text-white">{trade.symbol || trade.pair || 'N/A'}</TableCell>
                <TableCell>
                  <Badge 
                    variant={trade.direction === "long" ? "success" : "destructive"}
                    className="flex items-center w-fit gap-1"
                  >
                    {trade.direction === "long" ? (
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    ) : (
                      <ArrowDownRight className="h-3.5 w-3.5" />
                    )}
                    {trade.direction === "long" ? "Long" : "Short"}
                  </Badge>
                </TableCell>
                <TableCell className="text-gray-900 dark:text-gray-100">${safeToFixed(trade.entry_price, 4)}</TableCell>
                <TableCell className="text-gray-900 dark:text-gray-100">${safeToFixed(trade.exit_price, 4)}</TableCell>
                <TableCell className={`font-medium ${(trade.pnl_usdt || 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                  ${safeToFixed(trade.pnl_usdt)} ({safeToFixed(trade.pnl_percentage)}%)
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2 text-gray-900 dark:text-gray-100">
                    {formatDate(trade.exit_timestamp)}
                    <Link to={createPageUrl(`TradeDetail?id=${trade.id || trade.trade_id}`)}>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-500 dark:text-gray-400">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {trades.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-6 text-gray-500 dark:text-gray-400">
                  No recent trades found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}