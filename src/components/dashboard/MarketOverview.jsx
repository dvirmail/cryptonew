
import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function MarketOverview({ marketData = [] }) {
  const [timeframe, setTimeframe] = useState("1d");
  const [data, setData] = useState([]);
  
  useEffect(() => {
    // Generate realistic BTC historical data
    const generateHistoricalBtcData = () => {
      // Data approximating Bitcoin's price movements in a volatile market
      const baseData = {
        "1h": [
          { time: "09:00", price: 39450 },
          { time: "10:00", price: 39560 },
          { time: "11:00", price: 39490 },
          { time: "12:00", price: 39720 },
          { time: "13:00", price: 39650 },
          { time: "14:00", price: 39550 },
          { time: "15:00", price: 39620 },
          { time: "16:00", price: 39720 },
          { time: "17:00", price: 39840 },
          { time: "18:00", price: 40010 },
          { time: "19:00", price: 40150 },
          { time: "20:00", price: 40250 },
          { time: "21:00", price: 40180 },
          { time: "22:00", price: 40230 },
          { time: "23:00", price: 40310 },
          { time: "00:00", price: 40420 }
        ],
        "4h": [
          { time: "Sep 1", price: 38200 },
          { time: "Sep 2", price: 38600 },
          { time: "Sep 3", price: 38420 },
          { time: "Sep 4", price: 38800 },
          { time: "Sep 5", price: 39200 },
          { time: "Sep 6", price: 39600 },
          { time: "Sep 7", price: 39750 },
          { time: "Sep 8", price: 40100 },
          { time: "Sep 9", price: 39900 },
          { time: "Sep 10", price: 40400 },
          { time: "Sep 11", price: 40600 },
          { time: "Sep 12", price: 40250 }
        ],
        "1d": [
          { time: "Aug 20", price: 37300 },
          { time: "Aug 21", price: 37150 },
          { time: "Aug 22", price: 37450 },
          { time: "Aug 23", price: 37800 },
          { time: "Aug 24", price: 37600 },
          { time: "Aug 25", price: 37400 },
          { time: "Aug 26", price: 37700 },
          { time: "Aug 27", price: 37900 },
          { time: "Aug 28", price: 38400 },
          { time: "Aug 29", price: 38600 },
          { time: "Aug 30", price: 39100 },
          { time: "Aug 31", price: 39300 },
          { time: "Sep 1", price: 38200 },
          { time: "Sep 2", price: 38600 },
          { time: "Sep 3", price: 38420 },
          { time: "Sep 4", price: 38800 },
          { time: "Sep 5", price: 39200 },
          { time: "Sep 6", price: 39600 },
          { time: "Sep 7", price: 39750 },
          { time: "Sep 8", price: 40100 },
          { time: "Sep 9", price: 39900 },
          { time: "Sep 10", price: 40400 },
          { time: "Sep 11", price: 40600 },
          { time: "Sep 12", price: 40250 }
        ],
        "1w": [
          { time: "Jul W1", price: 35500 },
          { time: "Jul W2", price: 36200 },
          { time: "Jul W3", price: 36800 },
          { time: "Jul W4", price: 36400 },
          { time: "Aug W1", price: 37100 },
          { time: "Aug W2", price: 37600 },
          { time: "Aug W3", price: 38300 },
          { time: "Aug W4", price: 38800 },
          { time: "Sep W1", price: 39500 },
          { time: "Sep W2", price: 40250 }
        ]
      };

      return baseData[timeframe] || baseData["1d"];
    };

    setData(generateHistoricalBtcData());
  }, [timeframe]);
  
  const formatTooltipValue = (value) => {
    return `$${value.toFixed(2)}`;
  };
  
  return (
    <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-gray-900 dark:text-white">BTC/USDT Overview</CardTitle>
        <Tabs defaultValue="1d" onValueChange={setTimeframe} className="bg-transparent">
          <TabsList className="bg-gray-100 dark:bg-gray-700">
            <TabsTrigger value="1h">1H</TabsTrigger>
            <TabsTrigger value="4h">4H</TabsTrigger>
            <TabsTrigger value="1d">1D</TabsTrigger>
            <TabsTrigger value="1w">1W</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid 
                strokeDasharray="3 3" 
                vertical={false} 
                stroke="currentColor"
                className="stroke-gray-200 dark:stroke-gray-700" 
              />
              <XAxis
                dataKey="time"
                tickFormatter={(value) => value}
                minTickGap={30}
                tick={{ fontSize: 12 }}
                stroke="currentColor"
                className="text-gray-500 dark:text-gray-400"
              />
              <YAxis
                domain={["auto", "auto"]}
                tickFormatter={(value) => `$${value}`}
                tick={{ fontSize: 12 }}
                stroke="currentColor"
                className="text-gray-500 dark:text-gray-400"
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--bg-color)",
                  border: "none",
                  borderRadius: "8px",
                  color: "var(--text-color)"
                }}
                formatter={(value) => [`$${value.toFixed(2)}`, "Price"]}
              />
              <Area
                type="monotone"
                dataKey="price"
                stroke="#3b82f6"
                fillOpacity={1}
                fill="url(#colorPrice)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
