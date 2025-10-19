import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Bell, Info, AlertCircle, Trash2, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { safeLoadMarketAlerts } from "@/components/utils/apiQueue";
import { queueEntityCall } from "@/components/utils/apiQueue";

export default function AlertsPage() {
    const [alerts, setAlerts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [updating, setUpdating] = useState(null);

    useEffect(() => {
        loadAlerts();
    }, []);

    const loadAlerts = async () => {
        setLoading(true);
        setError(null);
        
        try {
            // Use the safe loader that handles timeouts gracefully
            const alertData = await safeLoadMarketAlerts();
            setAlerts(alertData || []);
        } catch (err) {
            console.warn('[AlertsPage] Failed to load market alerts:', err.message);
            setError(`Failed to load alerts: ${err.message}`);
            setAlerts([]); // Fallback to empty array
        } finally {
            setLoading(false);
        }
    };

    const markAsRead = async (alertId) => {
        if (!alertId) return;
        
        setUpdating(alertId);
        try {
            await queueEntityCall('MarketAlert', 'update', alertId, { is_read: true });
            setAlerts(prev => prev.map(alert => 
                alert.id === alertId ? { ...alert, is_read: true } : alert
            ));
        } catch (err) {
            console.warn('[AlertsPage] Failed to mark alert as read:', err.message);
            // Don't show error to user for this minor operation
        } finally {
            setUpdating(null);
        }
    };

    const deleteAlert = async (alertId) => {
        if (!alertId) return;
        
        setUpdating(alertId);
        try {
            await queueEntityCall('MarketAlert', 'delete', alertId);
            setAlerts(prev => prev.filter(alert => alert.id !== alertId));
        } catch (err) {
            console.warn('[AlertsPage] Failed to delete alert:', err.message);
            // Don't show error to user for this minor operation
        } finally {
            setUpdating(null);
        }
    };

    const getSeverityIcon = (severity) => {
        switch (severity) {
            case 'critical': return <AlertTriangle className="h-5 w-5 text-red-500" />;
            case 'high': return <AlertCircle className="h-5 w-5 text-orange-500" />;
            case 'medium': return <Bell className="h-5 w-5 text-yellow-500" />;
            default: return <Info className="h-5 w-5 text-blue-500" />;
        }
    };

    const getSeverityVariant = (severity) => {
        switch (severity) {
            case 'critical': return 'destructive';
            case 'high': return 'destructive';
            case 'medium': return 'secondary';
            default: return 'outline';
        }
    };

    if (loading) {
        return (
            <div className="container mx-auto p-6">
                <div className="flex items-center justify-between mb-6">
                    <h1 className="text-3xl font-bold">Market Alerts</h1>
                </div>
                <div className="text-center py-12">
                    <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-gray-400" />
                    <p className="text-gray-500">Loading alerts...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="container mx-auto p-6">
                <div className="flex items-center justify-between mb-6">
                    <h1 className="text-3xl font-bold">Market Alerts</h1>
                    <Button onClick={loadAlerts} variant="outline">
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Retry
                    </Button>
                </div>
                <Card>
                    <CardContent className="text-center py-12">
                        <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
                        <h3 className="text-lg font-semibold mb-2">Alerts Temporarily Unavailable</h3>
                        <p className="text-gray-600 mb-4">
                            Unable to load market alerts due to system load. Market analysis continues normally.
                        </p>
                        <p className="text-sm text-gray-500">
                            {error}
                        </p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    const unreadAlerts = alerts.filter(alert => !alert.is_read);
    const readAlerts = alerts.filter(alert => alert.is_read);

    return (
        <div className="container mx-auto p-6">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-3xl font-bold">Market Alerts</h1>
                <div className="flex items-center gap-4">
                    <Badge variant="secondary">
                        {unreadAlerts.length} Unread
                    </Badge>
                    <Button onClick={loadAlerts} variant="outline">
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Refresh
                    </Button>
                </div>
            </div>

            {alerts.length === 0 ? (
                <Card>
                    <CardContent className="text-center py-12">
                        <Bell className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                        <h3 className="text-lg font-semibold mb-2">No Active Alerts</h3>
                        <p className="text-gray-600">
                            Market conditions are normal. New alerts will appear here when detected.
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-6">
                    {/* Unread Alerts */}
                    {unreadAlerts.length > 0 && (
                        <div>
                            <h2 className="text-xl font-semibold mb-4">Unread Alerts ({unreadAlerts.length})</h2>
                            <div className="space-y-4">
                                {unreadAlerts.map((alert) => (
                                    <AlertCard
                                        key={alert.id}
                                        alert={alert}
                                        updating={updating === alert.id}
                                        onMarkAsRead={markAsRead}
                                        onDelete={deleteAlert}
                                        getSeverityIcon={getSeverityIcon}
                                        getSeverityVariant={getSeverityVariant}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Read Alerts */}
                    {readAlerts.length > 0 && (
                        <div>
                            <h2 className="text-xl font-semibold mb-4">Read Alerts ({readAlerts.length})</h2>
                            <div className="space-y-4">
                                {readAlerts.map((alert) => (
                                    <AlertCard
                                        key={alert.id}
                                        alert={alert}
                                        updating={updating === alert.id}
                                        onMarkAsRead={markAsRead}
                                        onDelete={deleteAlert}
                                        getSeverityIcon={getSeverityIcon}
                                        getSeverityVariant={getSeverityVariant}
                                        isRead={true}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function AlertCard({ alert, updating, onMarkAsRead, onDelete, getSeverityIcon, getSeverityVariant, isRead = false }) {
    return (
        <Card className={`${isRead ? 'opacity-75' : ''} ${!alert.is_read ? 'border-l-4 border-l-blue-500' : ''}`}>
            <CardHeader>
                <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                        {getSeverityIcon(alert.severity)}
                        <div>
                            <CardTitle className="text-lg">{alert.title}</CardTitle>
                            <div className="flex items-center gap-2 mt-1">
                                <Badge variant={getSeverityVariant(alert.severity)}>
                                    {alert.severity || 'medium'}
                                </Badge>
                                <Badge variant="outline">
                                    {alert.type || 'technical'}
                                </Badge>
                                {alert.date_created && (
                                    <span className="text-sm text-gray-500">
                                        {new Date(alert.date_created).toLocaleDateString()}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {!alert.is_read && (
                            <Button
                                onClick={() => onMarkAsRead(alert.id)}
                                disabled={updating}
                                variant="outline"
                                size="sm"
                            >
                                {updating ? (
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                ) : (
                                    <>
                                        <Eye className="h-4 w-4 mr-1" />
                                        Mark Read
                                    </>
                                )}
                            </Button>
                        )}
                        <Button
                            onClick={() => onDelete(alert.id)}
                            disabled={updating}
                            variant="outline"
                            size="sm"
                        >
                            {updating ? (
                                <RefreshCw className="h-4 w-4 animate-spin" />
                            ) : (
                                <Trash2 className="h-4 w-4" />
                            )}
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <p className="text-gray-600 mb-4">{alert.description}</p>
                
                {alert.pairs_affected && alert.pairs_affected.length > 0 && (
                    <div className="mb-3">
                        <p className="text-sm font-medium mb-2">Affected Pairs:</p>
                        <div className="flex flex-wrap gap-1">
                            {alert.pairs_affected.map((pair, i) => (
                                <Badge key={i} variant="outline" className="text-xs">
                                    {pair}
                                </Badge>
                            ))}
                        </div>
                    </div>
                )}

                {alert.signals_involved && alert.signals_involved.length > 0 && (
                    <div>
                        <p className="text-sm font-medium mb-2">Related Signals:</p>
                        <div className="flex flex-wrap gap-1">
                            {alert.signals_involved.map((signal, i) => (
                                <Badge key={i} variant="secondary" className="text-xs">
                                    {signal}
                                </Badge>
                            ))}
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}