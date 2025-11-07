/**
 * PendingOrderManager - Tracks and monitors submitted orders
 * 
 * This service ensures that all submitted orders are properly tracked,
 * monitored for completion, and retried if they fail.
 */

import { queueFunctionCall } from '@/components/utils/apiQueue';
import { liveTradingAPI } from '@/api/functions';

export class PendingOrderManager {
    constructor(scannerService) {
        this.scannerService = scannerService;
        this.pendingOrders = new Map(); // orderId -> orderInfo
        this.failedOrders = new Map(); // orderId -> failureInfo
        this.maxRetries = 3;
        this.checkInterval = 10000; // 10 seconds
        this.maxPendingTime = 300000; // 5 minutes
        this.isMonitoring = false;
        this.monitoringInterval = null;
    }

    /**
     * Add a pending order to be monitored
     * @param {Object} orderInfo - Order information
     * @param {string} orderInfo.orderId - Binance order ID
     * @param {string} orderInfo.symbol - Trading symbol
     * @param {string} orderInfo.side - BUY or SELL
     * @param {number} orderInfo.quantity - Order quantity
     * @param {number} orderInfo.price - Order price
     * @param {string} orderInfo.tradingMode - testnet or live
     * @param {string} orderInfo.proxyUrl - Proxy URL
     * @param {Object} orderInfo.metadata - Additional order metadata
     */
    addPendingOrder(orderInfo) {
        const orderId = orderInfo.orderId;
        if (!orderId) {
            console.error('[PendingOrderManager] ❌ Cannot add order without orderId:', orderInfo);
            return false;
        }

        const pendingOrder = {
            ...orderInfo,
            submittedAt: Date.now(),
            lastChecked: Date.now(),
            retryCount: 0,
            status: 'PENDING',
            checks: []
        };

        this.pendingOrders.set(orderId, pendingOrder);
        
        console.log(`[PendingOrderManager] 📝 Added pending order ${orderId} for ${orderInfo.symbol} ${orderInfo.side}`);
        this.scannerService.addLog(`[ORDER_TRACKING] 📝 Tracking order ${orderId} for ${orderInfo.symbol} ${orderInfo.side}`, 'info');

        // Start monitoring if not already running
        if (!this.isMonitoring) {
            this.startMonitoring();
        }

        return true;
    }

    /**
     * Start monitoring pending orders
     */
    startMonitoring() {
        if (this.isMonitoring) {
            return;
        }

        this.isMonitoring = true;
        console.log('[PendingOrderManager] 🔍 Starting order monitoring...');
        this.scannerService.addLog('[ORDER_MONITORING] 🔍 Starting pending order monitoring', 'system');

        this.monitoringInterval = setInterval(() => {
            this.checkPendingOrders();
        }, this.checkInterval);
    }

    /**
     * Stop monitoring pending orders
     */
    stopMonitoring() {
        if (!this.isMonitoring) {
            return;
        }

        this.isMonitoring = false;
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }

        console.log('[PendingOrderManager] ⏹️ Stopped order monitoring');
        this.scannerService.addLog('[ORDER_MONITORING] ⏹️ Stopped pending order monitoring', 'system');
    }

    /**
     * Check all pending orders for status updates
     */
    async checkPendingOrders() {
        if (this.pendingOrders.size === 0) {
            return;
        }

        console.log(`[PendingOrderManager] 🔍 Checking ${this.pendingOrders.size} pending orders...`);

        const ordersToCheck = Array.from(this.pendingOrders.values());
        const now = Date.now();

        for (const order of ordersToCheck) {
            try {
                // Check if order is too old
                if (now - order.submittedAt > this.maxPendingTime) {
                    console.log(`[PendingOrderManager] ⏰ Order ${order.orderId} expired after ${Math.round((now - order.submittedAt) / 1000)}s`);
                    await this.handleExpiredOrder(order);
                    continue;
                }

                // Check order status
                await this.checkOrderStatus(order);

            } catch (error) {
                console.error(`[PendingOrderManager] ❌ Error checking order ${order.orderId}:`, error);
                order.checks.push({
                    timestamp: now,
                    error: error.message,
                    status: 'ERROR'
                });
            }
        }
    }

    /**
     * Check the status of a specific order
     * @param {Object} order - Order to check
     */
    async checkOrderStatus(order) {
        const now = Date.now();
        
        try {
            console.log(`[PendingOrderManager] 🔍 Checking order ${order.orderId} status...`);

            const orderStatusResponse = await queueFunctionCall(
                'liveTradingAPI',
                liveTradingAPI,
                {
                    action: 'getOrder',
                    tradingMode: order.tradingMode,
                    proxyUrl: order.proxyUrl,
                    symbol: order.symbol,
                    orderId: order.orderId
                },
                'normal',
                null,
                0,
                30000
            );

            const orderStatus = orderStatusResponse?.data?.data || orderStatusResponse?.data;
            
            if (!orderStatus) {
                throw new Error('No order status returned from Binance');
            }

            // Record the check
            order.lastChecked = now;
            order.checks.push({
                timestamp: now,
                status: orderStatus.status,
                executedQty: orderStatus.executedQty,
                avgPrice: orderStatus.avgPrice,
                cummulativeQuoteQty: orderStatus.cummulativeQuoteQty
            });

            console.log(`[PendingOrderManager] 📊 Order ${order.orderId} status: ${orderStatus.status}`);

            // Handle different order statuses
            switch (orderStatus.status) {
                case 'FILLED':
                    await this.handleFilledOrder(order, orderStatus);
                    break;
                case 'PARTIALLY_FILLED':
                    await this.handlePartiallyFilledOrder(order, orderStatus);
                    break;
                case 'CANCELED':
                case 'REJECTED':
                case 'EXPIRED':
                    await this.handleFailedOrder(order, orderStatus);
                    break;
                case 'NEW':
                case 'PENDING_NEW':
                    // Order is still pending, continue monitoring
                    console.log(`[PendingOrderManager] ⏳ Order ${order.orderId} still pending`);
                    break;
                default:
                    console.log(`[PendingOrderManager] ❓ Unknown order status: ${orderStatus.status}`);
            }

        } catch (error) {
            console.error(`[PendingOrderManager] ❌ Error checking order ${order.orderId}:`, error);
            
            // Increment retry count
            order.retryCount++;
            
            if (order.retryCount >= this.maxRetries) {
                console.log(`[PendingOrderManager] ❌ Order ${order.orderId} exceeded max retries`);
                await this.handleFailedOrder(order, { status: 'MAX_RETRIES_EXCEEDED', error: error.message });
            }
        }
    }

    /**
     * Handle a filled order
     * @param {Object} order - Order information
     * @param {Object} orderStatus - Order status from Binance
     */
    async handleFilledOrder(order, orderStatus) {
        console.log(`[PendingOrderManager] ✅ Order ${order.orderId} filled successfully`);
        
        this.scannerService.addLog(
            `[ORDER_FILLED] ✅ Order ${order.orderId} filled: ${orderStatus.executedQty} ${order.symbol} at ${orderStatus.avgPrice}`,
            'success'
        );

        // Remove from pending orders
        this.pendingOrders.delete(order.orderId);

        // If this was a BUY order, trigger position creation
        if (order.side === 'BUY' && order.metadata?.signal) {
            console.log(`[PendingOrderManager] 🚀 Triggering position creation for filled BUY order ${order.orderId}`);
            await this.triggerPositionCreation(order, orderStatus);
        }

        // If this was a SELL order, trigger position closure
        if (order.side === 'SELL' && order.metadata?.positionId) {
            console.log(`[PendingOrderManager] 🚀 Triggering position closure for filled SELL order ${order.orderId}`);
            await this.triggerPositionClosure(order, orderStatus);
        }
    }

    /**
     * Handle a partially filled order
     * @param {Object} order - Order information
     * @param {Object} orderStatus - Order status from Binance
     */
    async handlePartiallyFilledOrder(order, orderStatus) {
        console.log(`[PendingOrderManager] ⚠️ Order ${order.orderId} partially filled: ${orderStatus.executedQty}/${order.quantity}`);
        
        this.scannerService.addLog(
            `[ORDER_PARTIAL] ⚠️ Order ${order.orderId} partially filled: ${orderStatus.executedQty}/${order.quantity} ${order.symbol}`,
            'warning'
        );

        // Continue monitoring for full fill
        // Could implement partial position creation here if needed
    }

    /**
     * Handle a failed order
     * @param {Object} order - Order information
     * @param {Object} orderStatus - Order status from Binance
     */
    async handleFailedOrder(order, orderStatus) {
        console.log(`[PendingOrderManager] ❌ Order ${order.orderId} failed: ${orderStatus.status}`);
        
        this.scannerService.addLog(
            `[ORDER_FAILED] ❌ Order ${order.orderId} failed: ${orderStatus.status}`,
            'error'
        );

        // Move to failed orders
        this.failedOrders.set(order.orderId, {
            ...order,
            failedAt: Date.now(),
            failureReason: orderStatus.status,
            failureDetails: orderStatus
        });

        // Remove from pending orders
        this.pendingOrders.delete(order.orderId);

        // Attempt retry if it was a BUY order and we haven't exceeded retries
        if (order.side === 'BUY' && order.retryCount < this.maxRetries && order.metadata?.signal) {
            console.log(`[PendingOrderManager] 🔄 Attempting retry for failed BUY order ${order.orderId}`);
            await this.retryOrder(order);
        }
    }

    /**
     * Handle an expired order
     * @param {Object} order - Order information
     */
    async handleExpiredOrder(order) {
        console.log(`[PendingOrderManager] ⏰ Order ${order.orderId} expired`);
        
        this.scannerService.addLog(
            `[ORDER_EXPIRED] ⏰ Order ${order.orderId} expired after ${Math.round((Date.now() - order.submittedAt) / 1000)}s`,
            'warning'
        );

        // Move to failed orders
        this.failedOrders.set(order.orderId, {
            ...order,
            failedAt: Date.now(),
            failureReason: 'EXPIRED',
            failureDetails: { status: 'EXPIRED' }
        });

        // Remove from pending orders
        this.pendingOrders.delete(order.orderId);
    }

    /**
     * Retry a failed order
     * @param {Object} order - Order information
     */
    async retryOrder(order) {
        console.log(`[PendingOrderManager] 🔄 Retrying order ${order.orderId} (attempt ${order.retryCount + 1})`);
        
        try {
            // Create new order with same parameters
            const retryOrderInfo = {
                symbol: order.symbol,
                side: order.side,
                type: 'MARKET',
                quantity: order.quantity,
                tradingMode: order.tradingMode,
                proxyUrl: order.proxyUrl,
                metadata: order.metadata
            };

            const retryResponse = await queueFunctionCall(
                'liveTradingAPI',
                liveTradingAPI,
                {
                    action: 'createOrder',
                    ...retryOrderInfo
                },
                'critical',
                null,
                0,
                30000
            );

            if (retryResponse?.orderId) {
                console.log(`[PendingOrderManager] ✅ Retry order submitted: ${retryResponse.orderId}`);
                
                // Add new order to monitoring
                this.addPendingOrder({
                    ...retryOrderInfo,
                    orderId: retryResponse.orderId,
                    retryCount: order.retryCount + 1
                });

                this.scannerService.addLog(
                    `[ORDER_RETRY] 🔄 Retry order ${retryResponse.orderId} submitted for ${order.symbol} ${order.side}`,
                    'info'
                );
            } else {
                throw new Error('Retry order did not return orderId');
            }

        } catch (error) {
            console.error(`[PendingOrderManager] ❌ Retry failed for order ${order.orderId}:`, error);
            this.scannerService.addLog(
                `[ORDER_RETRY] ❌ Retry failed for order ${order.orderId}: ${error.message}`,
                'error'
            );
        }
    }

    /**
     * Trigger position creation for a filled BUY order
     * @param {Object} order - Order information
     * @param {Object} orderStatus - Order status from Binance
     */
    async triggerPositionCreation(order, orderStatus) {
        try {
            console.log(`[PendingOrderManager] 🚀 Triggering position creation for order ${order.orderId}`);
            
            // Get the original signal
            const signal = order.metadata?.signal;
            if (!signal) {
                console.error(`[PendingOrderManager] ❌ No signal metadata for order ${order.orderId}`);
                return;
            }

            // Create position data
            // CRITICAL FIX: Get the ACTUAL executed price from Binance (source of truth)
            // Priority: avgPrice > price > calculate from fills
            let executedPrice = null;
            
            // Try avgPrice first (most reliable)
            if (orderStatus?.avgPrice && 
                typeof orderStatus.avgPrice === 'number' &&
                !isNaN(orderStatus.avgPrice) &&
                orderStatus.avgPrice > 0) {
                executedPrice = parseFloat(orderStatus.avgPrice);
                console.log(`[PendingOrderManager] ✅ Using Binance avgPrice for ${order.symbol}: $${executedPrice}`);
            }
            // Fallback to price field
            else if (orderStatus?.price &&
                     typeof orderStatus.price === 'number' &&
                     !isNaN(orderStatus.price) &&
                     orderStatus.price > 0) {
                executedPrice = parseFloat(orderStatus.price);
                console.log(`[PendingOrderManager] ✅ Using Binance price field for ${order.symbol}: $${executedPrice}`);
            }
            // Fallback: Calculate from fills array if available
            else if (Array.isArray(orderStatus?.fills) && orderStatus.fills.length > 0) {
                const fills = orderStatus.fills;
                let totalQty = 0;
                let totalCost = 0;
                fills.forEach(fill => {
                    const qty = parseFloat(fill.qty || fill.quantity || 0);
                    const price = parseFloat(fill.price || 0);
                    if (qty > 0 && price > 0) {
                        totalQty += qty;
                        totalCost += qty * price;
                    }
                });
                if (totalQty > 0 && totalCost > 0) {
                    executedPrice = totalCost / totalQty;
                    console.log(`[PendingOrderManager] ✅ Calculated executed price from fills for ${order.symbol}: $${executedPrice} (${fills.length} fills)`);
                }
            }
            
            // Final fallback to order.price if executedPrice is still invalid
            if (!executedPrice || executedPrice <= 0 || isNaN(executedPrice)) {
                console.warn(`[PendingOrderManager] ⚠️ Could not get valid executed price from Binance for ${order.symbol}, using order.price:`, {
                    executedPrice: executedPrice,
                    orderPrice: order.price,
                    orderStatus: orderStatus
                });
                executedPrice = parseFloat(order.price) || 0;
            }
            
            // VALIDATION: Ensure executed price is realistic (not mock/test data)
            if (executedPrice && order.price && order.price > 0) {
                const priceDiff = Math.abs(executedPrice - order.price);
                const priceDiffPercent = (priceDiff / order.price) * 100;
                
                // If executed price differs by more than 20% from order price, log a warning
                if (priceDiffPercent > 20) {
                    console.warn(`[PendingOrderManager] ⚠️ Executed price differs significantly from order price for ${order.symbol}:`, {
                        executedPrice: executedPrice,
                        orderPrice: order.price,
                        difference: priceDiff,
                        differencePercent: `${priceDiffPercent.toFixed(2)}%`,
                        warning: 'Price difference exceeds 20% - possible stale/mock data'
                    });
                }
                
                // CRITICAL: If executed price is way off (more than 50% different), use order.price as fallback but log error
                if (priceDiffPercent > 50) {
                    console.error(`[PendingOrderManager] ❌ CRITICAL: Executed price is way off for ${order.symbol}, using order.price instead:`, {
                        executedPrice: executedPrice,
                        orderPrice: order.price,
                        difference: priceDiff,
                        differencePercent: `${priceDiffPercent.toFixed(2)}%`,
                        action: 'Using order.price as fallback'
                    });
                    executedPrice = parseFloat(order.price);
                }
            }
            
            console.log(`[PendingOrderManager] ✅ Final executed price for ${order.symbol}: $${executedPrice} (source: Binance order result)`);
            
            // CRITICAL VALIDATION: Ensure signal has all required analytics fields
            if (!signal.strategy_name) {
                throw new Error(`Cannot create position: signal missing strategy_name`);
            }
            if (signal.combined_strength === undefined || signal.combined_strength === null) {
                console.warn(`[PendingOrderManager] ⚠️ Signal missing combined_strength, defaulting to 0`);
            }
            if (signal.convictionScore === undefined && signal.conviction_score === undefined) {
                console.warn(`[PendingOrderManager] ⚠️ Signal missing conviction_score, defaulting to 0`);
            }
            if (!signal.market_regime) {
                console.warn(`[PendingOrderManager] ⚠️ Signal missing market_regime, defaulting to 'unknown'`);
            }
            
            const positionData = {
                position_id: `pos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                strategy_name: signal.strategy_name,
                symbol: order.symbol,
                direction: 'long', // Assuming BUY orders are long
                entry_price: executedPrice,
                current_price: executedPrice, // CRITICAL FIX: Set current_price to prevent ghost detection
                quantity_crypto: parseFloat(orderStatus.executedQty) || order.quantity,
                entry_value_usdt: (parseFloat(orderStatus.executedQty) || order.quantity) * executedPrice,
                conviction_score: signal.convictionScore || signal.conviction_score || 0,
                conviction_details: signal.convictionDetails || {},
                conviction_breakdown: signal.conviction_breakdown || {},
                conviction_multiplier: signal.conviction_multiplier || 1,
                market_regime: signal.market_regime || 'unknown',
                regime_confidence: signal.regime_confidence || 0,
                combined_strength: signal.combined_strength !== undefined && signal.combined_strength !== null ? signal.combined_strength : 0, // CRITICAL: Ensure combined_strength is set
                atr_value: signal.atr_value || null,
                is_event_driven_strategy: signal.is_event_driven_strategy || false,
                // Add Fear & Greed Index and LPM score for analytics
                fear_greed_score: this.scannerService.state.fearAndGreedData?.value || null,
                fear_greed_classification: this.scannerService.state.fearAndGreedData?.value_classification || null,
                lpm_score: this.scannerService.state.performanceMomentumScore || null,
                
                // NEW: Capture additional analytics at position opening
                // Use PositionManager helper methods if available
                volatility_at_open: this.scannerService.positionManager?._calculateVolatilityAtOpen?.(signal.atr_value, executedPrice, signal) || null,
                volatility_label_at_open: this.scannerService.positionManager?._getVolatilityLabel?.(signal.atr_value, executedPrice, signal) || null,
                regime_impact_on_strength: signal.regime_impact_on_strength || signal.strength_breakdown?.regimeAdjustment || null,
                correlation_impact_on_strength: signal.correlation_impact_on_strength || signal.strength_breakdown?.correlationAdjustment || null,
                effective_balance_risk_at_open: this.scannerService?.state?.adjustedBalanceRiskFactor || null,
                btc_price_at_open: await this._getBitcoinPriceAtOpen(),
                
                // NEW: Entry quality metrics (use PositionManager helper if available)
                ...(this.scannerService.positionManager?._calculateEntryQuality 
                    ? await this.scannerService.positionManager._calculateEntryQuality(symbol, executedPrice, signal)
                    : {}),
                
                trigger_signals: signal.trigger_signals || [],
                entry_timestamp: new Date().toISOString(),
                status: 'open',
                trading_mode: order.tradingMode,
                wallet_id: this.scannerService._getCurrentWalletState()?.id,
                binance_order_id: order.orderId,
                binance_executed_price: executedPrice,
                binance_executed_quantity: parseFloat(orderStatus.executedQty),
                created_date: new Date().toISOString(),
                last_updated_timestamp: new Date().toISOString(),
                last_price_update: new Date().toISOString(), // Track when price was last updated
                // Calculate time_exit_hours and exit_time
                time_exit_hours: (() => {
                    // Try to get from signal combination or use PositionManager method
                    const combination = signal.combination || signal.originalStrategy;
                    if (combination && this.scannerService.positionManager) {
                        return this.scannerService.positionManager.calculateExitTimeFromStrategy(combination, executedPrice);
                    }
                    // Fallback to signal.time_exit_hours or default 24 hours
                    return signal.time_exit_hours || 24;
                })(),
                exit_time: null // Will be calculated below
            };
            
            // Calculate exit_time: entry_timestamp + time_exit_hours
            const entryTimestamp = new Date(positionData.entry_timestamp);
            const exitTimeHours = positionData.time_exit_hours || 24;
            const exitTime = new Date(entryTimestamp.getTime() + (exitTimeHours * 60 * 60 * 1000));
            positionData.exit_time = exitTime.toISOString();

            // Create position in database
            const { LivePosition } = await import('@/api/entities');
            const createdPosition = await LivePosition.create(positionData);

            if (createdPosition && createdPosition.id) {
                console.log(`[PendingOrderManager] ✅ Position created: ${createdPosition.id}`);
                
                // CRITICAL FIX: Map ALL fields from createdPosition to ensure analytics fields are preserved
                // This matches the mapping in PositionManager to ensure consistency
                this.scannerService.positionManager.positions.push({
                    id: createdPosition.id,
                    position_id: createdPosition.position_id,
                    db_record_id: createdPosition.id,
                    strategy_name: createdPosition.strategy_name,
                    symbol: createdPosition.symbol,
                    direction: createdPosition.direction,
                    entry_price: parseFloat(createdPosition.entry_price),
                    quantity_crypto: parseFloat(createdPosition.quantity_crypto),
                    entry_value_usdt: parseFloat(createdPosition.entry_value_usdt),
                    entry_timestamp: createdPosition.entry_timestamp,
                    status: createdPosition.status,
                    stop_loss_price: parseFloat(createdPosition.stop_loss_price) || 0,
                    take_profit_price: parseFloat(createdPosition.take_profit_price) || 0,
                    enableTrailingTakeProfit: createdPosition.enableTrailingTakeProfit ?? true,
                    is_trailing: createdPosition.is_trailing || false,
                    trailing_stop_price: createdPosition.trailing_stop_price,
                    trailing_peak_price: createdPosition.trailing_peak_price,
                    peak_price: parseFloat(createdPosition.peak_price) || parseFloat(createdPosition.entry_price) || 0,
                    trough_price: parseFloat(createdPosition.trough_price) || parseFloat(createdPosition.entry_price) || 0,
                    time_exit_hours: parseFloat(createdPosition.time_exit_hours) || 24,
                    trigger_signals: createdPosition.trigger_signals || [],
                    // CRITICAL: Include ALL analytics fields to prevent nulls in trades
                    combined_strength: createdPosition.combined_strength,
                    conviction_score: createdPosition.conviction_score,
                    conviction_breakdown: createdPosition.conviction_breakdown,
                    conviction_multiplier: createdPosition.conviction_multiplier,
                    market_regime: createdPosition.market_regime,
                    regime_confidence: createdPosition.regime_confidence,
                    atr_value: createdPosition.atr_value,
                    is_event_driven_strategy: createdPosition.is_event_driven_strategy || false,
                    fear_greed_score: createdPosition.fear_greed_score,
                    fear_greed_classification: createdPosition.fear_greed_classification,
                    lpm_score: createdPosition.lpm_score,
                    wallet_allocation_percentage: createdPosition.wallet_allocation_percentage,
                    binance_order_id: createdPosition.binance_order_id,
                    wallet_id: createdPosition.wallet_id,
                    trading_mode: createdPosition.trading_mode,
                    created_date: createdPosition.created_date || createdPosition.entry_timestamp || new Date().toISOString(),
                    last_updated_timestamp: createdPosition.last_updated_timestamp || new Date().toISOString()
                });

                this.scannerService.addLog(
                    `[POSITION_CREATED] ✅ Position created from order ${order.orderId}: ${createdPosition.symbol} ${createdPosition.quantity_crypto}`,
                    'success'
                );
                
                // Dispatch event to refresh wallet page positions
                //console.log('[debug_save] PendingOrderManager: About to dispatch positionDataRefresh event');
                if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
                    const event = new CustomEvent('positionDataRefresh', { 
                        detail: { positionsOpened: 1, source: 'order_filled' } 
                    });
                    //console.log('[debug_save] PendingOrderManager: Created CustomEvent:', event.type);
                    window.dispatchEvent(event);
                    //console.log('[debug_save] PendingOrderManager: ✅ Dispatched positionDataRefresh event after position created from order');
                }
            } else {
                throw new Error('Position creation failed');
            }

        } catch (error) {
            console.error(`[PendingOrderManager] ❌ Position creation failed for order ${order.orderId}:`, error);
            this.scannerService.addLog(
                `[POSITION_CREATE_ERROR] ❌ Failed to create position from order ${order.orderId}: ${error.message}`,
                'error'
            );
        }
    }

    /**
     * Trigger position closure for a filled SELL order
     * @param {Object} order - Order information
     * @param {Object} orderStatus - Order status from Binance
     */
    async triggerPositionClosure(order, orderStatus) {
        try {
            console.log(`[PendingOrderManager] 🚀 Triggering position closure for order ${order.orderId}`);
            
            const positionId = order.metadata?.positionId;
            if (!positionId) {
                console.error(`[PendingOrderManager] ❌ No position ID metadata for order ${order.orderId}`);
                return;
            }

            // Find the position in PositionManager
            const position = this.scannerService.positionManager.positions.find(p => p.position_id === positionId);
            if (!position) {
                console.error(`[PendingOrderManager] ❌ Position ${positionId} not found for order ${order.orderId}`);
                return;
            }

            // Create trade data
            const COMMISSION_RATE = 0.001; // 0.1% trading fee (Binance spot)
            const exitPrice = parseFloat(orderStatus.avgPrice);
            const quantity = parseFloat(orderStatus.executedQty);
            const entryValue = position.entry_value_usdt;
            const exitValue = exitPrice * quantity;
            
            // Calculate gross P&L first
            const pnlGross = (exitPrice - position.entry_price) * quantity;
            
            // CRITICAL FIX: Deduct fees from P&L (matching PositionManager logic)
            const entryFees = entryValue * COMMISSION_RATE;
            const exitFees = exitValue * COMMISSION_RATE;
            const totalFees = entryFees + exitFees;
            const pnlUsdt = pnlGross - totalFees; // NET P&L (after fees)
            const pnlPercentage = entryValue > 0 ? (pnlUsdt / entryValue) * 100 : 0; // NET P&L percentage
            
            const tradeData = {
                trade_id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                position_id: position.position_id || positionId, // CRITICAL: All positions have position_id for duplicate detection
                strategy_name: position.strategy_name,
                symbol: position.symbol,
                direction: position.direction,
                entry_price: position.entry_price,
                exit_price: exitPrice,
                quantity_crypto: quantity,
                entry_value_usdt: entryValue,
                exit_value_usdt: exitValue,
                pnl_usdt: pnlUsdt, // NET P&L (after fees)
                pnl_percentage: pnlPercentage, // NET P&L percentage (after fees)
                entry_timestamp: position.entry_timestamp,
                exit_timestamp: new Date().toISOString(),
                duration_hours: position.entry_timestamp 
                    ? (Date.now() - new Date(position.entry_timestamp).getTime()) / (1000 * 3600)
                    : 0, // Calculate duration in hours (decimal) from entry to exit
                duration_seconds: position.entry_timestamp 
                    ? Math.floor((Date.now() - new Date(position.entry_timestamp).getTime()) / 1000)
                    : 0, // Also store seconds for backwards compatibility
                exit_reason: 'manual_close',
                trading_mode: order.tradingMode,
                trigger_signals: position.trigger_signals || [],
                combined_strength: position.combined_strength,
                conviction_score: position.conviction_score,
                conviction_breakdown: position.conviction_breakdown,
                conviction_multiplier: position.conviction_multiplier,
                market_regime: position.market_regime,
                regime_confidence: position.regime_confidence,
                atr_value: position.atr_value,
                is_event_driven_strategy: position.is_event_driven_strategy,
                // Add Fear & Greed Index and LPM score for analytics
                fear_greed_score: position.fear_greed_score,
                fear_greed_classification: position.fear_greed_classification,
                lpm_score: position.lpm_score,
                total_fees_usdt: totalFees, // CRITICAL: Include calculated fees
                created_date: new Date().toISOString(),
                updated_date: new Date().toISOString()
            };

            // Create trade in database
            const { Trade } = await import('@/api/entities');
            const createdTrade = await Trade.create(tradeData);

            if (createdTrade && createdTrade.id) {
                console.log(`[PendingOrderManager] ✅ Trade created: ${createdTrade.id}`);
                
                // Remove position from PositionManager
                const positionIndex = this.scannerService.positionManager.positions.findIndex(p => p.position_id === positionId);
                if (positionIndex !== -1) {
                    this.scannerService.positionManager.positions.splice(positionIndex, 1);
                }

                // Delete position from database
                const { LivePosition } = await import('@/api/entities');
                await LivePosition.delete(position.id);

                this.scannerService.addLog(
                    `[POSITION_CLOSED] ✅ Position closed from order ${order.orderId}: ${position.symbol} PnL: ${tradeData.pnl_usdt.toFixed(2)}`,
                    'success'
                );

                // Update historical performance tracking for regime learning
                try {
                    if (tradeData.market_regime && tradeData.pnl_usdt !== undefined) {
                        const { getRegimeContextWeighting } = await import('@/components/utils/unifiedStrengthCalculator');
                        const regimeWeighting = getRegimeContextWeighting();
                        const wasSuccessful = tradeData.pnl_usdt > 0;
                        regimeWeighting.updateHistoricalPerformance(tradeData.market_regime, wasSuccessful);
                    }
                } catch (perfError) {
                    console.warn('[PendingOrderManager] ⚠️ Failed to update historical performance:', perfError.message);
                    // Don't throw - trade was saved successfully
                }

                // Dispatch event to refresh trade history page
                if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
                    window.dispatchEvent(new CustomEvent('tradeDataRefresh'));
                    console.log('[PendingOrderManager] ✅ Dispatched tradeDataRefresh event after trade save');
                }
            } else {
                throw new Error('Trade creation failed');
            }

        } catch (error) {
            console.error(`[PendingOrderManager] ❌ Position closure failed for order ${order.orderId}:`, error);
            this.scannerService.addLog(
                `[POSITION_CLOSE_ERROR] ❌ Failed to close position from order ${order.orderId}: ${error.message}`,
                'error'
            );
        }
    }

    /**
     * Get statistics about pending and failed orders
     * @returns {Object} Statistics
     */
    getStatistics() {
        const now = Date.now();
        const pendingOrders = Array.from(this.pendingOrders.values());
        const failedOrders = Array.from(this.failedOrders.values());

        return {
            pending: {
                count: pendingOrders.length,
                oldest: pendingOrders.length > 0 ? Math.round((now - Math.min(...pendingOrders.map(o => o.submittedAt))) / 1000) : 0,
                newest: pendingOrders.length > 0 ? Math.round((now - Math.max(...pendingOrders.map(o => o.submittedAt))) / 1000) : 0
            },
            failed: {
                count: failedOrders.length,
                recent: failedOrders.filter(o => now - o.failedAt < 300000).length // Last 5 minutes
            },
            monitoring: {
                active: this.isMonitoring,
                interval: this.checkInterval
            }
        };
    }

    /**
     * Clean up old failed orders
     */
    /**
     * Get Bitcoin price at position opening
     * @returns {Promise<number|null>} Bitcoin price in USDT or null if unavailable
     */
    async _getBitcoinPriceAtOpen() {
        try {
            // Try to get from price cache first
            const priceCache = this.scannerService?.priceCacheService;
            if (priceCache) {
                const btcPrice = await priceCache.getPrice('BTCUSDT');
                if (btcPrice && typeof btcPrice === 'number' && btcPrice > 0) {
                    return btcPrice;
                }
            }
            
            // Fallback: Try to get from live prices
            const livePrices = this.scannerService?.state?.livePrices;
            if (livePrices?.BTCUSDT?.price) {
                const price = parseFloat(livePrices.BTCUSDT.price);
                if (!isNaN(price) && price > 0) {
                    return price;
                }
            }
            
            // Last resort: Fetch from API
            try {
                const tradingMode = this.scannerService?.getTradingMode?.() || 'testnet';
                const response = await fetch(`http://localhost:3003/api/binance/ticker/price?symbol=BTCUSDT&tradingMode=${tradingMode}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data?.success && data?.data?.price) {
                        const price = parseFloat(data.data.price);
                        if (!isNaN(price) && price > 0) {
                            return price;
                        }
                    }
                }
            } catch (fetchError) {
                console.warn('[PendingOrderManager] Error fetching Bitcoin price from API:', fetchError);
            }
            
            return null;
        } catch (error) {
            console.warn('[PendingOrderManager] Error getting Bitcoin price at open:', error);
            return null;
        }
    }

    cleanupOldFailedOrders() {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours

        for (const [orderId, order] of this.failedOrders.entries()) {
            if (now - order.failedAt > maxAge) {
                this.failedOrders.delete(orderId);
            }
        }
    }
}

export default PendingOrderManager;
