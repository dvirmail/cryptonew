import React, { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { format } from 'date-fns';

// Minimal functional components for Card, CardHeader etc.
const Card = ({ children, className = '' }) => (
  <div className={`rounded-lg border bg-card text-card-foreground shadow-sm ${className}`}>
    {children}
  </div>
);
const CardHeader = ({ children, className = '' }) => (
  <div className={`flex flex-col space-y-1.5 p-6 ${className}`}>
    {children}
  </div>
);
const CardTitle = ({ children, className = '' }) => (
  <h3 className={`text-2xl font-semibold leading-none tracking-tight ${className}`}>
    {children}
  </h3>
);
const CardDescription = ({ children, className = '' }) => (
  <p className={`text-sm text-muted-foreground ${className}`}>
    {children}
  </p>
);
const CardContent = ({ children, className = '' }) => (
  <div className={`p-6 pt-0 ${className}`}>
    {children}
  </div>
);

export default function OccurrenceChart({ matches }) {
  const chartData = useMemo(() => {
    if (!matches || matches.length === 0) return [];

    console.log('OccurrenceChart: Processing', matches.length, 'matches');
    
    // Log sample timestamps to debug
    if (matches.length > 0) {
      console.log('Sample timestamps:', matches.slice(0, 5).map(m => ({
        original: m.time,
        type: typeof m.time,
        asDate: new Date(m.time),
        formatted: new Date(m.time).toISOString()
      })));
    }

    const dailyCounts = {};

    matches.forEach((match, index) => {
      let timestamp;
      
      // Handle different timestamp formats
      if (typeof match.time === 'number') {
        timestamp = match.time;
      } else if (typeof match.time === 'string') {
        timestamp = parseInt(match.time, 10);
        if (isNaN(timestamp)) {
          timestamp = new Date(match.time).getTime();
        }
      } else if (match.time instanceof Date) {
        timestamp = match.time.getTime();
      } else {
        console.warn('Invalid timestamp format:', match.time);
        return;
      }

      // Create date object from timestamp
      const date = new Date(timestamp);
      
      if (isNaN(date.getTime())) {
        console.warn('Invalid date created from timestamp:', timestamp);
        return;
      }

      // FIX: Use consistent date formatting that avoids timezone issues
      // Format as YYYY-MM-DD using local time to avoid UTC shifting
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateKey = `${year}-${month}-${day}`;

      if (!dailyCounts[dateKey]) {
        dailyCounts[dateKey] = { 
          date: dateKey, 
          successful: 0, 
          failed: 0,
          timestamp: date.getTime() // Keep original timestamp for sorting
        };
      }

      if (match.successful) {
        dailyCounts[dateKey].successful++;
      } else {
        dailyCounts[dateKey].failed++;
      }
    });

    // Convert to array and sort by actual date
    const sortedData = Object.values(dailyCounts)
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(item => ({
        date: item.date,
        successful: item.successful,
        failed: item.failed,
        displayDate: format(new Date(item.timestamp), 'MMM dd'),
        total: item.successful + item.failed
      }));

    console.log('OccurrenceChart: Generated chart data:', {
      totalDays: sortedData.length,
      dateRange: sortedData.length > 0 ? {
        first: sortedData[0].date,
        last: sortedData[sortedData.length - 1].date
      } : null,
      sampleData: sortedData.slice(0, 3)
    });

    return sortedData;
  }, [matches]);

  if (!chartData || chartData.length === 0) {
    return (
      <div className="text-center py-4 text-gray-500">
        No occurrence data available
      </div>
    );
  }

  // Calculate totals for CardDescription
  const totalOccurrences = chartData.reduce((sum, item) => sum + item.total, 0);
  const totalSuccessful = chartData.reduce((sum, item) => sum + item.successful, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Daily Signal Occurrences</CardTitle>
        <CardDescription className="text-xs">
          Total occurrences: {totalOccurrences} |
          Successful: {totalSuccessful} |
          Date range: {chartData.length > 0 ? `${chartData[0].displayDate} to ${chartData[chartData.length - 1].displayDate}` : 'No data'} |
          Days with data: {chartData.length}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
              <XAxis
                dataKey="displayDate"
                tick={{ fontSize: 10 }}
                angle={-45}
                textAnchor="end"
                height={60}
                interval={Math.max(0, Math.floor(chartData.length / 10))} // Show fewer labels for readability
              />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
              <Tooltip
                labelFormatter={(label) => {
                  const item = chartData.find(d => d.displayDate === label);
                  return item ? `Date: ${format(new Date(item.date + 'T12:00:00'), 'MMM dd, yyyy')}` : label;
                }}
                formatter={(value, name) => [value, name.charAt(0).toUpperCase() + name.slice(1)]}
              />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Bar dataKey="failed" stackId="a" fill="#ef4444" name="Failed" />
              <Bar dataKey="successful" stackId="a" fill="#22c55e" name="Successful" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}