
import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';
import {
  AlertCircle,
  AlertTriangle,
  BarChart,
  BarChart2,
  CheckCircle,
  CheckCircle2,
  Clock,
  Code,
  Copy,
  DollarSign,
  FileText,
  Flag,
  Info,
  Lock,
  Pause,
  Play,
  RefreshCw,
  Rocket,
  Search,
  Target,
  TrendingUp,
  XCircle,
  Zap
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

// NEW: Add keyframes for flickering animation
const flickerAnimation = `
  @keyframes flicker {
    0%, 100% {
      opacity: 1;
      text-shadow: 0 0 4px #34d399, 0 0 8px #34d399;
    }
    50% {
      opacity: 0.7;
      text-shadow: none;
    }
  }
  .animate-flicker {
    animation: flicker 1.5s ease-in-out infinite;
  }
  @keyframes flicker-yellow {
    0%, 100% {
      opacity: 1;
      text-shadow: 0 0 4px #fbbf24, 0 0 8px #fbbf24;
    }
    50% {
      opacity: 0.7;
      text-shadow: none;
    }
  }
  .animate-flicker-yellow {
    animation: flicker-yellow 1.5s ease-in-out infinite;
  }
  @keyframes flicker-blue {
    0%, 100% {
      opacity: 1;
      text-shadow: 0 0 4px #3b82f6, 0 0 8px #3b82f6;
    }
    50% {
      opacity: 0.7;
      text-shadow: none;
    }
  }
  .animate-flicker-blue {
    animation: flicker-blue 1.5s ease-in-out infinite;
  }
  /* ADDED: Keyframe for orange flicker */
  @keyframes flicker-orange {
    0%, 100% {
      opacity: 1;
      text-shadow: 0 0 4px #f97316, 0 0 8px #f97316;
    }
    50% {
      opacity: 0.8;
      text-shadow: none;
    }
  }
  .animate-flicker-orange {
    animation: flicker-orange 2s ease-in-out infinite;
  }
`;

// NEW: Add function to extract conviction score from log message
const extractConvictionScore = (message) => {
  // Pattern 1: "Conviction Score: 38.9 | Multiplier: 1.00"
  const convictionMatch = message.match(/Conviction Score:\s*(\d+\.?\d*)/i);
  if (convictionMatch) {
    return parseFloat(convictionMatch[1]);
  }
  
  // Pattern 2: "[CONVICTION_FAIL] Core 38.9 below threshold (50)"
  const convictionFailMatch = message.match(/Core\s+(\d+\.?\d*)\s+below threshold/i);
  if (convictionFailMatch) {
    return parseFloat(convictionFailMatch[1]);
  }
  
  return null;
};

// NEW: Check if conviction score is above threshold
const isHighConvictionScore = (message, threshold = 50) => {
  const score = extractConvictionScore(message);
  return score !== null && score >= threshold;
};

// REPLACE the generic extractor to only use strategy-level strengths.
// It now:
// - uses "Live Strength: NNN" if present
// - otherwise uses "Combined Strength: NNN"
// - ignores indicator detail lines like ">>>>>" and "(Strength: 47)"
const extractStrengthFromMessage = (message = "") => {
  if (!message || typeof message !== "string") return null;
  // Ignore our own injected summary line
  if (/scanned strategies avg strength/i.test(message)) return null;

  // Ignore indicator detail lines and inline indicator strengths
  if (/>>>>>\s/.test(message)) return null;           // signal detail lines
  if (/\(Strength:\s*-?\d+\.?\d*\)/i.test(message)) return null; // inline indicator strength

  // Prefer explicit strategy-level line
  let m = message.match(/Live\s+Strength:\s*(-?\d+\.?\d*)/i);
  if (m && m[1] != null) {
    const v = Number(m[1]);
    return Number.isFinite(v) ? v : null;
  }

  // Fallback to combined strength at strategy level
  m = message.match(/Combined[\s_]*Strength[^0-9\-]*(-?\d+\.?\d*)/i);
  if (m && m[1] != null) {
    const v = Number(m[1]);
    return Number.isFinite(v) ? v : null;
  }

  return null;
};

const extractStrengthFromLog = (log) => {
  // Prefer structured data if present
  const d = log?.data || {};
  const candidates = [
    d.combinedStrength,
    d.combined_strength,
    d.strength,
    d.value, // sometimes strength is stored as value for signal_strength logs
  ].map((v) => (typeof v === "number" ? v : Number(v)));

  for (const v of candidates) {
    if (Number.isFinite(v) && Math.abs(v) < 10000) return v;
  }

  // Fallback: parse from message text
  return extractStrengthFromMessage(log?.message || "");
};

const getLogStyle = (type) => {
  switch (type) {
    case 'error':
      return { icon: <AlertTriangle className="h-4 w-4 text-red-500" />, color: 'text-red-400' };
    // ENHANCED: Specific styling for insufficient balance warnings
    case 'insufficient_balance':
      return { icon: <AlertTriangle className="h-4 w-4 text-orange-500" />, color: 'text-orange-400', className: 'animate-flicker-orange' };
    // NEW: Bright orange flickering for regime confidence filtering
    case 'regime_confidence_filter':
      return { icon: <AlertTriangle className="h-4 w-4 text-orange-500" />, color: 'text-orange-400', className: 'animate-flicker-orange' };
    case 'success':
      return { icon: <CheckCircle className="h-4 w-4 text-green-500" />, color: 'text-green-400' };
    case 'signal_match': // State Match
      return { icon: <CheckCircle className="h-4 w-4 text-green-500" />, color: 'text-green-400' };
    case 'signal_event_match': // Event Match
      return { icon: <Zap className="h-4 w-4 text-amber-500" />, color: 'text-amber-400' };
    case 'regime_info': // NEW: Green color for market regime and scanning strategy info
      return { icon: <Target className="h-4 w-4 text-green-500" />, color: 'text-green-400' };
    case 'start':
      return { icon: <Play className="h-4 w-4 text-green-500" />, color: 'text-green-400' };
    case 'stop':
      return { icon: <Pause className="h-4 w-4 text-yellow-500" />, color: 'text-yellow-400' };
    case 'cycle':
      return { icon: <RefreshCw className="h-4 w-4 text-blue-500" />, color: 'text-blue-400' };
    case 'evaluating_strategy':
    case 'scan':
      return { icon: <Search className="h-4 w-4 text-cyan-500" />, color: 'text-cyan-400' };
    case 'strategy':
      return { icon: <Target className="h-4 w-4 text-purple-500" />, color: 'text-purple-400' };
    case 'signal_mismatch':
      return { icon: <AlertCircle className="h-4 w-4 text-red-500" />, color: 'text-gray-200' }; // White-ish text for mismatch
    case 'signal_not_found':
      return { icon: <AlertCircle className="h-4 w-4 text-red-500" />, color: 'text-gray-500' }; // Muted text for not found
    case 'combination_result':
      return { icon: <FileText className="h-4 w-4 text-indigo-500" />, color: 'text-indigo-400' };
    case 'signal_strength':
      return { icon: <Zap className="h-4 w-4 text-orange-500" />, color: 'text-orange-400' };
    case 'trade_signal': // CHANGED: Now magenta color
      return { icon: <TrendingUp className="h-4 w-4 text-fuchsia-500" />, color: 'text-fuchsia-400' };
    case 'trade_blocked': // Custom color for blocked trades
      return { icon: <AlertTriangle className="h-4 w-4 text-[#f98b1c]" />, color: 'text-[#f98b1c]' };
    case 'position_opening':
      return { icon: <Target className="h-4 w-4 text-blue-500" />, color: 'text-blue-400' };
    case 'position_opened':
      return { icon: <CheckCircle className="h-4 w-4 text-yellow-500" />, color: 'text-yellow-400', className: 'animate-flicker-yellow' };
    case 'execution_success': // NEW: Flickering blue for successful trade execution
      return { icon: <Rocket className="h-4 w-4 text-blue-500" />, color: 'text-blue-400', className: 'animate-flicker-blue' };
    case 'balance_update':
      return { icon: <DollarSign className="h-4 w-4 text-blue-500" />, color: 'text-blue-400' };
    default:
      return { icon: <Code className="h-4 w-4 text-gray-500" />, color: 'text-gray-400' };
  }
};

const formatLogData = (log) => {
  if (!log.data?.value) return null;

  const { indicatorType, value } = log.data;
  if (value === null || value === undefined) return null;

  try {
    switch (indicatorType) {
      case 'stochastic':
        return `%K: ${value.k?.toFixed(2)}, %D: ${value.d?.toFixed(2)}`;
      case 'williamsr':
        return `Williams %R: ${value?.toFixed(2)}`;
      case 'roc':
        return `ROC: ${(value * 100)?.toFixed(2)}%`;
      case 'cmo':
        return `CMO: ${value?.toFixed(2)}`;
      case 'macd':
        return `MACD: ${value.macd?.toFixed(4)}, Signal: ${value.signal?.toFixed(4)}, Hist: ${value.histogram?.toFixed(4)}`;
      default:
        return null; // Don't show JSON for other types
    }
  } catch (e) {
    return null;
  }
};

export default function LogDisplay({ logs, currentAverageSignalStrength }) {
  const { toast } = useToast();

  // NEW: Persist last known non-empty avg across renders
  const persistentAvgRef = React.useRef(null);

  // Precompute average strength per cycle end (log.type === 'cycle')
  const cycleAvgMap = useMemo(() => {
    const map = new Map();
    let strengths = [];

    (logs || []).forEach((log, idx) => {
      const s = extractStrengthFromLog(log);
      if (Number.isFinite(s)) {
        strengths.push(s);
      }

      // Heuristic: any 'cycle' log marks the end of a scan cycle summary
      if (log?.type === 'cycle') {
        if (strengths.length > 0) {
          const avg =
            strengths.reduce((a, b) => a + b, 0) / Math.max(1, strengths.length);
          map.set(idx, avg);
        }
        strengths = []; // reset for next cycle window
      }
    });

    return map;
  }, [logs]);

  // REPLACE augmentedLogs builder to add diagnostics for N/A cases
  const augmentedLogs = React.useMemo(() => {
    const result = [];
    let lastKnownNonEmptyAvg = Number.isFinite(persistentAvgRef.current) ? persistentAvgRef.current : null;
    let lastCycleAvg = null;
    let strengthsSinceLastCycle = [];

    // Helper: scan recent history (up to N entries back from index) to compute an average strength
    const scanBackForAvg = (fromIndex, maxBack = 150) => {
      let sum = 0;
      let count = 0;
      for (let j = fromIndex - 1; j >= 0 && (fromIndex - j) <= maxBack; j--) {
        const s = extractStrengthFromLog(logs[j]);
        if (Number.isFinite(s)) {
          sum += s;
          count += 1;
        }
      }
      if (count > 0) return sum / count;
      return null;
    };

    (logs || []).forEach((log, idx) => {
      // Accumulate strengths continuously for the current cycle window
      const s = extractStrengthFromLog(log);
      if (Number.isFinite(s)) {
        strengthsSinceLastCycle.push(s);
      }

      // Cycle end: compute and persist avg
      if (log?.type === 'cycle') {
        const windowCount = strengthsSinceLastCycle.length;
        if (windowCount > 0) {
          lastCycleAvg =
            strengthsSinceLastCycle.reduce((a, b) => a + b, 0) /
            strengthsSinceLastCycle.length;

          // Persist to both local memo state and ref
          if (Number.isFinite(lastCycleAvg)) {
            lastKnownNonEmptyAvg = lastCycleAvg;
            persistentAvgRef.current = lastCycleAvg;
          }
        } else {
          lastCycleAvg = null;
        }

        // removed console diagnostics

        strengthsSinceLastCycle = [];
        result.push({ log, originalIndex: idx });
        return;
      }

      // Detect "[WALLET] Unrealized P&L" line
      const isWalletUnrealized =
        typeof log?.message === 'string' &&
        log.message.includes('[WALLET]') &&
        /Unrealized/i.test(log.message);

      if (isWalletUnrealized) {
        // Prefer per-cycle avg provided by parent if computed there
        let computedAvg = (typeof currentAverageSignalStrength === 'number')
          ? currentAverageSignalStrength
          : null;

        // 1) Fallback to latest cycle avg, 2) fallback to current-window avg
        if (!Number.isFinite(computedAvg)) {
          computedAvg = Number.isFinite(lastCycleAvg) ? lastCycleAvg : null;
        }

        if (!Number.isFinite(computedAvg) && strengthsSinceLastCycle.length > 0) {
          computedAvg =
            strengthsSinceLastCycle.reduce((a, b) => a + b, 0) /
            strengthsSinceLastCycle.length;
        }

        // 3) Fallback to the most recent avg from cycleAvgMap prior to this wallet line
        if (!Number.isFinite(computedAvg) && cycleAvgMap && cycleAvgMap.size > 0) {
          let mapFallback = null;
          for (const [cycleIdx, avg] of cycleAvgMap.entries()) {
            if (cycleIdx <= idx && Number.isFinite(avg)) {
              mapFallback = avg; // keep advancing to the latest <= idx
            }
          }
          if (Number.isFinite(mapFallback)) {
            computedAvg = mapFallback;
          }
        }

        // 4) Try scanning back through recent logs for strength values
        let backAvg = null;
        if (!Number.isFinite(computedAvg)) {
          backAvg = scanBackForAvg(idx, 300);
          if (Number.isFinite(backAvg)) {
            computedAvg = backAvg;
          }
        }

        // 5) Fallback to a persisted last-known non-empty avg
        if (!Number.isFinite(computedAvg) && Number.isFinite(lastKnownNonEmptyAvg)) {
          computedAvg = lastKnownNonEmptyAvg;
        }

        // If we now have a finite avg, persist it so next render can use it immediately
        if (Number.isFinite(computedAvg)) {
          persistentAvgRef.current = computedAvg;
        }

        // Always show a numeric if we have any historical avg; only show 'N/A' if truly none ever computed
        const hasHistorical = Number.isFinite(persistentAvgRef.current);
        const willBeNA = !Number.isFinite(computedAvg) && !hasHistorical;
        const avgText = Number.isFinite(computedAvg)
          ? computedAvg.toFixed(2)
          : (hasHistorical ? persistentAvgRef.current.toFixed(2) : 'N/A');

        // removed console diagnostics

        const injected = {
          type: 'signal_strength',
          timestamp: log.timestamp || new Date().toISOString(),
          message: `Scanned strategies avg strength: ${avgText}`,
          data: { level: (log?.data?.level ?? 0) + 1 },
          __injected: true,
        };
        result.push({ log: injected, originalIndex: idx, __injected: true });
      }

      // Push the current log
      result.push({ log, originalIndex: idx });
    });

    return result;
  }, [logs, cycleAvgMap, currentAverageSignalStrength]);

  const copyLogsToClipboard = () => {
    // Ensure augmentedLogs is used, or fallback to original logs formatted consistently
    const logsToCopy = augmentedLogs.length > 0 ? augmentedLogs : logs.map(l => ({ log: l, originalIndex: -1 }));

    const logText = logsToCopy.map((item) => {
        const currentLog = item.log; // This is always the log object itself
        // CRITICAL FIX: Safely handle log.type that might be undefined or not a string
        const logType = currentLog.type && typeof currentLog.type === 'string' ? currentLog.type.toUpperCase() : 'UNKNOWN';
        const timestamp = currentLog.timestamp ? format(new Date(currentLog.timestamp), 'HH:mm:ss.SSS') : 'NO_TIME';
        const message = currentLog.message || '';
        return `${timestamp} [${logType}] ${message}`;
      }).join('\n');
    
    navigator.clipboard.writeText(logText);
    toast({
      title: "Logs Copied",
      description: "Scanner activity has been copied to your clipboard."
    });
  };

  return (
    <div className="space-y-4">
      {/* NEW: Inject the animation styles into the component */}
      <style>{flickerAnimation}</style>
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Activity Log ({logs.length} entries)</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={copyLogsToClipboard}
          className="flex items-center gap-2">
          <Copy className="h-4 w-4" />
          Copy Logs
        </Button>
      </div>
      
      {/* MODIFIED: Increased height and made it more flexible for scrolling */}
      <ScrollArea className="bg-gray-950 p-4 text-xs font-mono relative overflow-hidden h-[600px] w-full rounded-lg border max-h-[80vh]">
        {(augmentedLogs && augmentedLogs.length > 0) ? (
          <div>
            {augmentedLogs.map((item, index) => {
              const originalIndex = item.originalIndex; // Original index from the 'logs' array
              const log = item.log; // The actual log object

              const logType = log.type && typeof log.type === 'string' ? log.type : 'info';
              const { icon, color, className } = getLogStyle(logType);
              const formattedData = formatLogData(log);

              // **FIX**: Correctly read the level from the data object
              const level = log.data?.level || 0;
              let indentClass = '';
              if (level === 1) indentClass = 'ml-4';
              else if (level === 2) indentClass = 'ml-8';
              else if (level === 3) indentClass = 'ml-12'; // Deeper indentation

              // NEW: Check if this log has a high conviction score
              const hasHighConviction = isHighConvictionScore(log.message);
              const convictionTextColor = hasHighConviction ? 'text-fuchsia-400' : color;

              // Preserve previous behavior: append avg to cycle summary line too
              // This only applies to the *original* cycle logs, not the injected avg strength summary
              let displayMessage = log.message || '';
              if (logType === 'cycle' && cycleAvgMap.has(originalIndex)) {
                const avg = cycleAvgMap.get(originalIndex);
                if (Number.isFinite(avg)) {
                  displayMessage += ` • Avg strength: ${avg.toFixed(2)}`;
                }
              }

              return (
                // Use a key that combines injected status, original index, and current map index
                <div key={`${item.__injected ? 'injected' : 'log'}-${originalIndex}-${index}`} className={`mb-1 ${indentClass}`}>
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5">{icon}</div>
                    <div className="flex-grow">
                      <span className="text-gray-400 mr-2">
                        {log.timestamp ? format(new Date(log.timestamp), 'HH:mm:ss') : '--:--:--'}
                      </span>
                      {/* MODIFIED: show augmented message (with avg strength on cycle end) */}
                      <span className={`${convictionTextColor} font-medium ${className || ''}`}>
                        {displayMessage}
                      </span>
                    </div>
                  </div>
                  {formattedData && (
                    <div className="text-gray-500 text-[11px] mt-1 pl-10 font-sans">
                      {formattedData}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-gray-400 text-center py-16">
            <p>Scanner logs will appear here...</p>
            <p>Start the scanner to begin monitoring.</p>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
