
import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

export default function SignalPerformanceChart({ signals = [] }) {
  const [period, setPeriod] = useState("30d");
  const [chartType, setChartType] = useState("success-rate");
  
  // Process the data based on the chart type
  const chartData = signals.map(signal => {
    return {
      name: signal.name,
      value: chartType === "success-rate" 
        ? signal.success_rate 
        : chartType === "profit" 
          ? signal.avg_profit 
          : signal.trade_count,
      color: getBarColor(
        chartType === "success-rate" 
          ? signal.success_rate 
          : chartType === "profit" 
            ? signal.avg_profit 
            : signal.trade_count,
        chartType
      )
    };
  }).sort((a, b) => b.value - a.value);

  function getBarColor(value, type) {
    if (type === "success-rate") {
      if (value >= 60) return "#10b981"; // Success green
      if (value >= 50) return "#f59e0b"; // Warning yellow
      return "#ef4444"; // Error red
    } else if (type === "profit") {
      if (value >= 5) return "#10b981"; // Success green
      if (value >= 0) return "#f59e0b"; // Warning yellow
      return "#ef4444"; // Error red
    } else {
      return "#3b82f6"; // Primary blue
    }
  }

  function getChartLabel() {
    if (chartType === "success-rate") return "Success Rate (%)";
    if (chartType === "profit") return "Avg. Profit (%)";
    return "Number of Trades";
  }

  return (
    <Card className="col-span-1 lg:col-span-2 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-gray-900 dark:text-white">Signal Performance</CardTitle>
        <div className="flex items-center gap-2">
          <Select
            value={chartType}
            onValueChange={setChartType}
          >
            <SelectTrigger className="w-[160px] bg-white dark:bg-gray-800">
              <SelectValue placeholder="Metric" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="success-rate">Success Rate</SelectItem>
              <SelectItem value="profit">Average Profit</SelectItem>
              <SelectItem value="count">Trade Count</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {/* Update chart colors */}
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            data={chartData}
            margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
          >
            <CartesianGrid 
              strokeDasharray="3 3" 
              stroke="currentColor" 
              className="stroke-gray-200 dark:stroke-gray-700" 
            />
            <XAxis 
              dataKey="name" 
              tick={{ fill: 'currentColor' }}
              stroke="currentColor"
              className="text-gray-500 dark:text-gray-400"
            />
            <YAxis
              tick={{ fill: 'currentColor' }}
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
            />
            <Bar dataKey="value" fill="#3b82f6" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
