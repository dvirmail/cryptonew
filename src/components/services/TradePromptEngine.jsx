/**
 * Trade Prompt Engineering System
 * Formats trade analytics data for AI analysis
 */
export class TradePromptEngine {
    /**
     * Generate trade summary for AI analysis
     * @param {Array} trades - Array of trade objects
     * @param {string} timeframe - Timeframe filter (e.g., '7d', '30d', 'all')
     * @returns {Object} Formatted trade summary
     */
    static generateTradeSummary(trades, timeframe = 'all') {
        if (!trades || trades.length === 0) {
            return {
                summary: 'No trades available for analysis',
                metrics: {},
                insights: []
            };
        }

        const filteredTrades = this._filterTradesByTimeframe(trades, timeframe);
        const metrics = this._calculateMetrics(filteredTrades);
        const insights = this._identifyPatterns(filteredTrades, metrics);

        return {
            summary: this._formatSummary(metrics, filteredTrades.length),
            metrics: metrics,
            insights: insights,
            trades: filteredTrades.slice(0, 10), // Include last 10 trades for context
            timeframe: timeframe
        };
    }

    /**
     * Generate detailed analysis prompt for a specific trade
     * @param {Object} trade - Trade object
     * @returns {string} Formatted analysis prompt
     */
    static generateTradeAnalysisPrompt(trade) {
        if (!trade) {
            return 'No trade data provided';
        }

        const prompt = `
Analyze this trade in detail:

TRADE DETAILS:
- Symbol: ${trade.symbol || 'N/A'}
- Strategy: ${trade.strategy_name || 'N/A'}
- Direction: ${trade.direction || 'N/A'}
- Entry Price: $${parseFloat(trade.entry_price || 0).toFixed(4)}
- Exit Price: $${parseFloat(trade.exit_price || 0).toFixed(4)}
- P&L: $${parseFloat(trade.pnl_usdt || 0).toFixed(2)} (${parseFloat(trade.pnl_percentage || 0).toFixed(2)}%)
- Duration: ${parseFloat(trade.duration_hours || 0).toFixed(2)} hours
- Exit Reason: ${trade.exit_reason || 'N/A'}

ENTRY CONDITIONS:
- Market Regime: ${trade.market_regime || 'N/A'} (Confidence: ${parseFloat(trade.regime_confidence || 0).toFixed(1)}%)
- Fear & Greed: ${trade.fear_greed_classification || 'N/A'} (${trade.fear_greed_score || 'N/A'}/100)
- Volatility: ${trade.volatility_label_at_open || 'N/A'} (${parseFloat(trade.volatility_at_open || 0).toFixed(1)}/100)
- Combined Strength: ${parseFloat(trade.combined_strength || 0).toFixed(2)}
- Conviction Score: ${parseFloat(trade.conviction_score || 0).toFixed(2)}
- Regime Impact: ${parseFloat(trade.regime_impact_on_strength || 0).toFixed(2)}
- Correlation Impact: ${parseFloat(trade.correlation_impact_on_strength || 0).toFixed(2)}
- Effective Balance Risk: ${parseFloat(trade.effective_balance_risk_at_open || 0).toFixed(1)}/100
- Bitcoin Price: $${parseFloat(trade.btc_price_at_open || 0).toLocaleString()}

ENTRY QUALITY:
- Near Support: ${trade.entry_near_support ? 'Yes' : 'No'}
- Near Resistance: ${trade.entry_near_resistance ? 'Yes' : 'No'}
- Distance to Support: ${trade.entry_distance_to_support_percent !== null ? parseFloat(trade.entry_distance_to_support_percent).toFixed(2) + '%' : 'N/A'}
- Distance to Resistance: ${trade.entry_distance_to_resistance_percent !== null ? parseFloat(trade.entry_distance_to_resistance_percent).toFixed(2) + '%' : 'N/A'}
- Momentum Score: ${trade.entry_momentum_score !== null ? parseFloat(trade.entry_momentum_score).toFixed(1) : 'N/A'}/100
- Relative to Day High: ${trade.entry_relative_to_day_high_percent !== null ? parseFloat(trade.entry_relative_to_day_high_percent).toFixed(2) + '%' : 'N/A'}
- Relative to Day Low: ${trade.entry_relative_to_day_low_percent !== null ? parseFloat(trade.entry_relative_to_day_low_percent).toFixed(2) + '%' : 'N/A'}
- Volume vs Average: ${trade.entry_volume_vs_average !== null ? parseFloat(trade.entry_volume_vs_average).toFixed(2) + 'x' : 'N/A'}

EXIT CONDITIONS:
- Market Regime at Exit: ${trade.market_regime_at_exit || 'N/A'}
- Fear & Greed at Exit: ${trade.fear_greed_classification_at_exit || 'N/A'} (${trade.fear_greed_score_at_exit || 'N/A'}/100)
- Volatility at Exit: ${trade.volatility_label_at_exit || 'N/A'}

TRADE PERFORMANCE:
- Max Favorable Excursion (MFE): ${trade.max_favorable_excursion ? parseFloat(trade.max_favorable_excursion).toFixed(4) : 'N/A'}
- Max Adverse Excursion (MAE): ${trade.max_adverse_excursion ? parseFloat(trade.max_adverse_excursion).toFixed(4) : 'N/A'}
- Peak Profit: ${trade.peak_profit_percent ? parseFloat(trade.peak_profit_percent).toFixed(2) + '%' : 'N/A'}
- Peak Loss: ${trade.peak_loss_percent ? parseFloat(trade.peak_loss_percent).toFixed(2) + '%' : 'N/A'}
- Stop Loss Hit: ${trade.sl_hit_boolean ? 'Yes' : 'No'}
- Take Profit Hit: ${trade.tp_hit_boolean ? 'Yes' : 'No'}
- Distance to SL at Exit: ${trade.distance_to_sl_at_exit ? parseFloat(trade.distance_to_sl_at_exit).toFixed(2) + '%' : 'N/A'}
- Distance to TP at Exit: ${trade.distance_to_tp_at_exit ? parseFloat(trade.distance_to_tp_at_exit).toFixed(2) + '%' : 'N/A'}
- Time in Profit: ${trade.time_in_profit_hours ? parseFloat(trade.time_in_profit_hours).toFixed(2) + ' hours' : 'N/A'}
- Time in Loss: ${trade.time_in_loss_hours ? parseFloat(trade.time_in_loss_hours).toFixed(2) + ' hours' : 'N/A'}

STRATEGY CONTEXT:
- Strategy Win Rate at Entry: ${trade.strategy_win_rate_at_entry ? parseFloat(trade.strategy_win_rate_at_entry).toFixed(2) + '%' : 'N/A'}
- Strategy Occurrences: ${trade.strategy_occurrences_at_entry || 'N/A'}
- Similar Trades Count: ${trade.similar_trades_count || 'N/A'}
- Consecutive Wins Before: ${trade.consecutive_wins_before || 0}
- Consecutive Losses Before: ${trade.consecutive_losses_before || 0}

Provide a detailed analysis of:
1. Why this trade succeeded or failed
2. Key factors that influenced the outcome
3. What could have been done differently
4. Recommendations for similar trades in the future
`;

        return prompt.trim();
    }

    /**
     * Generate portfolio-level analysis prompt
     * @param {Array} trades - All trades
     * @param {Object} summary - Trade summary metrics
     * @returns {string} Formatted analysis prompt
     */
    static generatePortfolioAnalysisPrompt(trades, summary) {
        const prompt = `
Analyze the overall trading performance:

PORTFOLIO METRICS:
${JSON.stringify(summary.metrics, null, 2)}

KEY INSIGHTS:
${summary.insights.map((insight, i) => `${i + 1}. ${insight}`).join('\n')}

RECENT TRADES SAMPLE:
${summary.trades.slice(0, 5).map(trade => 
    `- ${trade.symbol}: ${trade.direction} | P&L: ${parseFloat(trade.pnl_usdt || 0).toFixed(2)} | Strategy: ${trade.strategy_name || 'N/A'} | Exit: ${trade.exit_reason || 'N/A'}`
).join('\n')}

Provide:
1. Overall performance assessment
2. Key strengths and weaknesses
3. Top recommendations for improvement
4. Risk management suggestions
5. Strategy optimization opportunities
`;

        return prompt.trim();
    }

    /**
     * Filter trades by timeframe
     * @private
     */
    static _filterTradesByTimeframe(trades, timeframe) {
        if (timeframe === 'all') return trades;

        const now = Date.now();
        let cutoffTime;

        switch (timeframe) {
            case '7d':
                cutoffTime = now - (7 * 24 * 60 * 60 * 1000);
                break;
            case '30d':
                cutoffTime = now - (30 * 24 * 60 * 60 * 1000);
                break;
            case '90d':
                cutoffTime = now - (90 * 24 * 60 * 60 * 1000);
                break;
            default:
                return trades;
        }

        return trades.filter(trade => {
            const exitTime = trade.exit_timestamp ? new Date(trade.exit_timestamp).getTime() : 0;
            return exitTime >= cutoffTime;
        });
    }

    /**
     * Calculate key metrics
     * @private
     */
    static _calculateMetrics(trades) {
        if (trades.length === 0) {
            return {
                totalTrades: 0,
                winRate: 0,
                totalPnL: 0,
                avgPnL: 0,
                bestTrade: null,
                worstTrade: null,
                avgDuration: 0,
                totalFees: 0
            };
        }

        const winningTrades = trades.filter(t => parseFloat(t.pnl_usdt || 0) > 0);
        const losingTrades = trades.filter(t => parseFloat(t.pnl_usdt || 0) < 0);
        const totalPnL = trades.reduce((sum, t) => sum + parseFloat(t.pnl_usdt || 0), 0);
        const totalFees = trades.reduce((sum, t) => sum + parseFloat(t.total_fees_usdt || 0), 0);
        const avgDuration = trades.reduce((sum, t) => sum + parseFloat(t.duration_hours || 0), 0) / trades.length;

        const bestTrade = [...trades].sort((a, b) => parseFloat(b.pnl_usdt || 0) - parseFloat(a.pnl_usdt || 0))[0];
        const worstTrade = [...trades].sort((a, b) => parseFloat(a.pnl_usdt || 0) - parseFloat(b.pnl_usdt || 0))[0];

        return {
            totalTrades: trades.length,
            winningTrades: winningTrades.length,
            losingTrades: losingTrades.length,
            winRate: (winningTrades.length / trades.length) * 100,
            totalPnL: totalPnL,
            avgPnL: totalPnL / trades.length,
            bestTrade: {
                symbol: bestTrade.symbol,
                pnl: parseFloat(bestTrade.pnl_usdt || 0),
                strategy: bestTrade.strategy_name
            },
            worstTrade: {
                symbol: worstTrade.symbol,
                pnl: parseFloat(worstTrade.pnl_usdt || 0),
                strategy: worstTrade.strategy_name
            },
            avgDuration: avgDuration,
            totalFees: totalFees,
            netPnL: totalPnL - totalFees
        };
    }

    /**
     * Identify patterns in trades
     * @private
     */
    static _identifyPatterns(trades, metrics) {
        const insights = [];

        // Win rate analysis
        if (metrics.winRate > 60) {
            insights.push(`Strong win rate of ${metrics.winRate.toFixed(1)}% indicates good strategy selection`);
        } else if (metrics.winRate < 40) {
            insights.push(`Low win rate of ${metrics.winRate.toFixed(1)}% suggests strategy optimization needed`);
        }

        // P&L analysis
        if (metrics.netPnL > 0) {
            insights.push(`Profitable overall with net P&L of $${metrics.netPnL.toFixed(2)}`);
        } else {
            insights.push(`Overall loss of $${Math.abs(metrics.netPnL).toFixed(2)} - review exit strategies`);
        }

        // Exit reason analysis
        const exitReasons = {};
        trades.forEach(trade => {
            const reason = trade.exit_reason || 'unknown';
            exitReasons[reason] = (exitReasons[reason] || 0) + 1;
        });
        const topExitReason = Object.entries(exitReasons).sort((a, b) => b[1] - a[1])[0];
        if (topExitReason) {
            insights.push(`Most common exit: ${topExitReason[0]} (${topExitReason[1]} trades, ${((topExitReason[1] / trades.length) * 100).toFixed(1)}%)`);
        }

        // Duration analysis
        if (metrics.avgDuration < 1) {
            insights.push(`Short average duration (${metrics.avgDuration.toFixed(2)}h) - may indicate quick scalping or premature exits`);
        } else if (metrics.avgDuration > 24) {
            insights.push(`Long average duration (${metrics.avgDuration.toFixed(2)}h) - consider if exits are optimal`);
        }

        return insights;
    }

    /**
     * Format summary text
     * @private
     */
    static _formatSummary(metrics, tradeCount) {
        return `
Total Trades: ${tradeCount}
Win Rate: ${metrics.winRate.toFixed(1)}%
Total P&L: $${metrics.totalPnL.toFixed(2)}
Net P&L (after fees): $${metrics.netPnL.toFixed(2)}
Average P&L per Trade: $${metrics.avgPnL.toFixed(2)}
Best Trade: ${metrics.bestTrade?.symbol || 'N/A'} (+$${metrics.bestTrade?.pnl.toFixed(2) || '0.00'})
Worst Trade: ${metrics.worstTrade?.symbol || 'N/A'} ($${metrics.worstTrade?.pnl.toFixed(2) || '0.00'})
Average Duration: ${metrics.avgDuration.toFixed(2)} hours
`.trim();
    }
}

export default TradePromptEngine;

