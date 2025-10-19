
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Trade } from "@/api/entities";
import { TradingSignal } from "@/api/entities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, ArrowDownRight, ArrowLeft, Calendar, Building, DollarSign, BarChart, LineChart, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { createPageUrl } from "@/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export default function TradeDetail() {
  const navigate = useNavigate();
  const [trade, setTrade] = useState(null);
  const [signals, setSignals] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Mock chart data for visualization
  const [chartData, setChartData] = useState([]);
  
  useEffect(() => {
    const fetchTradeData = async () => {
      setIsLoading(true);
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const tradeId = urlParams.get("id");
        
        if (!tradeId) {
          navigate(createPageUrl("TradeHistory"));
          return;
        }
        
        // Check if it's one of our demo BTC trades
        const demoTrades = [
          {
            id: "btc-trade-1",
            pair: "BTC/USDT",
            entry_price: 28450,
            exit_price: 28920,
            entry_date: "2023-09-10T09:30:00Z",
            exit_date: "2023-09-10T14:45:00Z",
            position_size: 0.15,
            direction: "long",
            pnl: 70.50,
            pnl_percentage: 1.65,
            signals_used: [
              {
                signal_id: "1",
                signal_name: "Moving Average Crossover",
                timeframe: "1h",
                value: "Bullish Crossover"
              }
            ],
            notes: "Strong momentum after key support level held, volume confirmed the move.",
            exchange: "Binance",
            status: "closed",
            time_of_day: "morning"
          },
          {
            id: "btc-trade-2",
            pair: "BTC/USDT",
            entry_price: 28100,
            exit_price: 27800,
            entry_date: "2023-09-08T14:20:00Z",
            exit_date: "2023-09-08T17:35:00Z",
            position_size: 0.18,
            direction: "short",
            pnl: 54.00,
            pnl_percentage: 1.07,
            signals_used: [
              {
                signal_id: "1",
                signal_name: "Moving Average Crossover",
                timeframe: "1h",
                value: "Bearish Crossover"
              },
              {
                signal_id: "4",
                signal_name: "MACD",
                timeframe: "4h",
                value: "Bearish Divergence"
              }
            ],
            notes: "Multiple confirmations helped with confidence in this trade. RSI showed overbought conditions.",
            exchange: "Binance",
            status: "closed",
            time_of_day: "afternoon"
          },
          {
            id: "btc-trade-3",
            pair: "BTC/USDT",
            entry_price: 27450,
            exit_price: 27950,
            entry_date: "2023-09-05T10:15:00Z",
            exit_date: "2023-09-06T09:30:00Z",
            position_size: 0.2,
            direction: "long",
            pnl: 100.00,
            pnl_percentage: 1.82,
            signals_used: [
              {
                signal_id: "3",
                signal_name: "Bollinger Bands",
                timeframe: "4h",
                value: "Lower Band Bounce"
              },
              {
                signal_id: "2",
                signal_name: "RSI",
                timeframe: "4h",
                value: "Oversold (28)"
              }
            ],
            notes: "Overnight position with strong risk-reward. RSI divergence confirmed entry.",
            exchange: "Binance",
            status: "closed",
            time_of_day: "morning"
          },
          {
            id: "btc-trade-4",
            pair: "BTC/USDT",
            entry_price: 29100,
            exit_price: 29420,
            entry_date: "2023-09-12T11:45:00Z",
            exit_date: "2023-09-12T16:30:00Z",
            position_size: 0.12,
            direction: "long",
            pnl: 38.40,
            pnl_percentage: 1.10,
            signals_used: [
              {
                signal_id: "5",
                signal_name: "Volume Profile",
                timeframe: "1h",
                value: "POC Support"
              }
            ],
            notes: "Volume confirmed the move, closed early as momentum slowed near resistance.",
            exchange: "Binance",
            status: "closed",
            time_of_day: "afternoon"
          }
        ];
        
        const demoTrade = demoTrades.find(t => t.id === tradeId);
        
        if (demoTrade) {
          setTrade(demoTrade);
          const signalsData = await TradingSignal.list();
          setSignals(signalsData);
          generateChartData(demoTrade);
        } else {
          const tradesData = await Trade.list();
          const signalsData = await TradingSignal.list();
          
          const foundTrade = tradesData.find(t => t.id === tradeId);
          
          if (!foundTrade) {
            navigate(createPageUrl("TradeHistory"));
            return;
          }
          
          setTrade(foundTrade);
          setSignals(signalsData);
          generateChartData(foundTrade);
        }
      } catch (error) {
        console.error("Error fetching trade details:", error);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchTradeData();
  }, [navigate]);
  
  const generateChartData = (trade) => {
    if (!trade) return;
    
    const data = [];
    const entryDate = new Date(trade.entry_date);
    const exitDate = new Date(trade.exit_date);
    const duration = exitDate - entryDate;
    const points = 20;
    const isProfitable = trade.pnl > 0;
    
    let currentPrice = trade.entry_price;
    const priceChange = (trade.exit_price - trade.entry_price) / points;
    
    // Create points before entry (slight movement)
    for (let i = -5; i < 0; i++) {
      const pointDate = new Date(entryDate);
      pointDate.setMinutes(pointDate.getMinutes() + i * 15);
      
      data.push({
        time: format(pointDate, "HH:mm"),
        price: currentPrice * (0.995 + Math.random() * 0.01),
        isEntry: false,
        isExit: false
      });
    }
    
    // Add entry point
    data.push({
      time: format(entryDate, "HH:mm"),
      price: trade.entry_price,
      isEntry: true,
      isExit: false
    });
    
    // Create points between entry and exit
    for (let i = 1; i < points; i++) {
      const pointDate = new Date(entryDate.getTime() + (duration * i) / points);
      
      // Add some randomness to make the chart look natural
      const randomFactor = 0.99 + Math.random() * 0.02;
      currentPrice += priceChange * randomFactor;
      
      data.push({
        time: format(pointDate, "HH:mm"),
        price: currentPrice,
        isEntry: false,
        isExit: false
      });
    }
    
    // Add exit point
    data.push({
      time: format(exitDate, "HH:mm"),
      price: trade.exit_price,
      isEntry: false,
      isExit: true
    });
    
    // Create points after exit (slight movement)
    let afterExitPrice = trade.exit_price;
    for (let i = 1; i <= 5; i++) {
      const pointDate = new Date(exitDate);
      pointDate.setMinutes(pointDate.getMinutes() + i * 15);
      
      // Continue the trend slightly
      afterExitPrice += isProfitable ? 
        afterExitPrice * 0.001 * (0.5 + Math.random()) : 
        -afterExitPrice * 0.001 * (0.5 + Math.random());
      
      data.push({
        time: format(pointDate, "HH:mm"),
        price: afterExitPrice,
        isEntry: false,
        isExit: false
      });
    }
    
    setChartData(data);
  };
  
  if (isLoading || !trade) {
    return (
      <div className="py-12 text-center">
        <p>Loading trade details...</p>
      </div>
    );
  }
  
  const formatCurrency = (value) => {
    return value.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD'
    });
  };
  
  return (
    <div>
      <div className="mb-8">
        <Button 
          variant="outline" 
          className="mb-4"
          onClick={() => navigate(createPageUrl("TradeHistory"))}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Trade History
        </Button>
        
        <h1 className="text-3xl font-bold">
          Trade Details: {trade.pair}
        </h1>
        <div className="flex items-center mt-2">
          <Badge 
            variant={trade.direction === "long" ? "success" : "destructive"}
            className="flex items-center gap-1 mr-3"
          >
            {trade.direction === "long" ? (
              <ArrowUpRight className="h-3.5 w-3.5" />
            ) : (
              <ArrowDownRight className="h-3.5 w-3.5" />
            )}
            {trade.direction === "long" ? "Long Position" : "Short Position"}
          </Badge>
          
          <Badge variant="outline" className="flex items-center gap-1 mr-3">
            <Calendar className="h-3.5 w-3.5" />
            {format(new Date(trade.entry_date), "MMM dd, yyyy")}
          </Badge>
          
          <Badge variant="outline" className="flex items-center gap-1">
            <Building className="h-3.5 w-3.5" />
            {trade.exchange}
          </Badge>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Profit & Loss
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${trade.pnl >= 0 ? "text-green-500" : "text-red-500"}`}>
              {formatCurrency(trade.pnl)}
            </div>
            <div className={`text-sm ${trade.pnl >= 0 ? "text-green-500" : "text-red-500"}`}>
              {trade.pnl_percentage.toFixed(2)}%
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <BarChart className="h-4 w-4" />
              Trade Size & Prices
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Position Size</p>
                <p className="font-medium">{trade.position_size}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Entry Price</p>
                <p className="font-medium">{formatCurrency(trade.entry_price)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Exit Price</p>
                <p className="font-medium">{formatCurrency(trade.exit_price)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Time of Day</p>
                <p className="font-medium capitalize">{trade.time_of_day}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <LineChart className="h-4 w-4" />
              Trade Duration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Entry Date</p>
                <p className="font-medium">{format(new Date(trade.entry_date), "MMM dd, yyyy HH:mm")}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Exit Date</p>
                <p className="font-medium">{format(new Date(trade.exit_date), "MMM dd, yyyy HH:mm")}</p>
              </div>
              <div className="col-span-2">
                <p className="text-sm text-muted-foreground">Duration</p>
                <p className="font-medium">
                  {(() => {
                    const duration = new Date(trade.exit_date) - new Date(trade.entry_date);
                    const hours = Math.floor(duration / (1000 * 60 * 60));
                    const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
                    return `${hours}h ${minutes}m`;
                  })()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader>
            <CardTitle>Price Chart</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={chartData}
                  margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                      <stop 
                        offset="5%" 
                        stopColor={trade.pnl >= 0 ? "#10b981" : "#ef4444"} 
                        stopOpacity={0.8} 
                      />
                      <stop 
                        offset="95%" 
                        stopColor={trade.pnl >= 0 ? "#10b981" : "#ef4444"} 
                        stopOpacity={0} 
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="time"
                    tickFormatter={(value) => value}
                    minTickGap={30}
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis
                    domain={["auto", "auto"]}
                    tickFormatter={(value) => `$${value.toFixed(2)}`}
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip
                    formatter={(value) => [`$${value.toFixed(2)}`, "Price"]}
                    labelFormatter={(value) => `Time: ${value}`}
                  />
                  <Area
                    type="monotone"
                    dataKey="price"
                    stroke={trade.pnl >= 0 ? "#10b981" : "#ef4444"}
                    fillOpacity={1}
                    fill="url(#colorPrice)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-between mt-4 text-sm text-muted-foreground">
              <div className="flex items-center">
                <div className="w-3 h-3 rounded-full bg-blue-500 mr-2"></div>
                <span>Entry: {format(new Date(trade.entry_date), "HH:mm")}</span>
              </div>
              <div className="flex items-center">
                <div className="w-3 h-3 rounded-full bg-purple-500 mr-2"></div>
                <span>Exit: {format(new Date(trade.exit_date), "HH:mm")}</span>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Signals Used</CardTitle>
          </CardHeader>
          <CardContent>
            {trade.signals_used && trade.signals_used.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Signal</TableHead>
                    <TableHead>Timeframe</TableHead>
                    <TableHead>Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trade.signals_used.map((signal, index) => {
                    const signalDetails = signals.find(s => s.id === signal.signal_id);
                    return (
                      <TableRow key={index}>
                        <TableCell className="font-medium">{signal.signal_name}</TableCell>
                        <TableCell>{signal.timeframe}</TableCell>
                        <TableCell>{signal.value}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <AlertTriangle className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p>No signals were recorded for this trade</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      
      {trade.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-line">{trade.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
