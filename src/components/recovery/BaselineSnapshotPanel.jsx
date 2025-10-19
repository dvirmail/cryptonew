import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, Play, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { createBaselineSnapshot } from "@/api/functions";

export default function BaselineSnapshotPanel() {
  const [mode, setMode] = React.useState("testnet");
  const [periodType, setPeriodType] = React.useState("both"); // daily | hourly | both
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState(null); // {type: 'success'|'error'|'info', message: string}

  const handleRun = async () => {
    setLoading(true);
    setResult(null);
    try {
      // Call backend function (will run service-side and create snapshots)
      const payload = { mode, periodType };
      const { data } = await createBaselineSnapshot(payload);

      // Normalize response - add defensive checks
      const responseData = data || {};
      const ok = responseData.success !== false;
      const message = responseData.message || (ok ? "Baseline snapshot(s) created successfully." : "Snapshot creation reported an issue.");

      setResult({ type: ok ? "success" : "error", message });
    } catch (err) {
      const errorMessage = err?.response?.data?.error || err?.message || "Failed to create baseline snapshots.";
      setResult({ type: "error", message: errorMessage });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Play className="w-5 h-5 text-indigo-600" />
          Create Baseline Snapshots
        </CardTitle>
        <CardDescription>
          Use this when you see "No baseline snapshot found…" logs. It will establish a fresh starting point for period calculations.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-end">
          <div className="flex-1">
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Mode</label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="testnet">Testnet</SelectItem>
                <SelectItem value="live">Live</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1">
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Period</label>
            <Select value={periodType} onValueChange={setPeriodType}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select period" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" /> Daily
                  </div>
                </SelectItem>
                <SelectItem value="hourly">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4" /> Hourly
                  </div>
                </SelectItem>
                <SelectItem value="both">Daily + Hourly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-end">
            <Button
              onClick={handleRun}
              disabled={loading}
              className="min-w-[200px] bg-indigo-600 hover:bg-indigo-700"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating…
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Play className="w-4 h-4" />
                  Create Baseline
                </span>
              )}
            </Button>
          </div>
        </div>

        {result && (
          <div className="mt-4">
            {result.type === "success" && (
              <Badge variant="success" className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4" /> {result.message}
              </Badge>
            )}
            {result.type === "error" && (
              <Badge variant="destructive" className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4" /> {result.message}
              </Badge>
            )}
            {result.type === "info" && (
              <Badge variant="secondary">{result.message}</Badge>
            )}
          </div>
        )}

        <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Tip: After creating a baseline, new hourly/daily snapshots will derive correct period deltas as long as the scanner stays online.
        </div>
      </CardContent>
    </Card>
  );
}