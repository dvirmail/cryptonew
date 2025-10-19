import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Bell, Info, AlertCircle } from 'lucide-react';
import { safeLoadMarketAlerts } from "@/components/utils/apiQueue";

export default function ActiveAlerts() {
    const [alerts, setAlerts] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

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
            console.warn('[ActiveAlerts] Failed to load market alerts:', err.message);
            setError(`Failed to load alerts: ${err.message}`);
            setAlerts([]); // Fallback to empty array
        } finally {
            setLoading(false);
        }
    };

    const getSeverityIcon = (severity) => {
        switch (severity) {
            case 'critical': return <AlertTriangle className="h-4 w-4 text-red-500" />;
            case 'high': return <AlertCircle className="h-4 w-4 text-orange-500" />;
            case 'medium': return <Bell className="h-4 w-4 text-yellow-500" />;
            default: return <Info className="h-4 w-4 text-blue-500" />;
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
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Bell className="h-5 w-5" />
                        Active Alerts
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="text-center py-4 text-gray-500">
                        Loading alerts...
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (error) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Bell className="h-5 w-5" />
                        Active Alerts
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="text-center py-4">
                        <AlertTriangle className="h-8 w-8 text-yellow-500 mx-auto mb-2" />
                        <p className="text-sm text-gray-600">
                            Alerts temporarily unavailable
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                            Market analysis continues normally
                        </p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Bell className="h-5 w-5" />
                    Active Alerts ({alerts.length})
                </CardTitle>
            </CardHeader>
            <CardContent>
                {alerts.length === 0 ? (
                    <div className="text-center py-4 text-gray-500">
                        <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>No active alerts</p>
                        <p className="text-xs mt-1">Market conditions are normal</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {alerts.slice(0, 5).map((alert, index) => (
                            <div key={alert.id || index} className="flex items-start gap-3 p-3 border rounded-lg">
                                {getSeverityIcon(alert.severity)}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-2">
                                        <h4 className="text-sm font-medium truncate">{alert.title}</h4>
                                        <Badge variant={getSeverityVariant(alert.severity)} className="text-xs">
                                            {alert.severity || 'medium'}
                                        </Badge>
                                    </div>
                                    <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                                        {alert.description}
                                    </p>
                                    {alert.pairs_affected && alert.pairs_affected.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mt-2">
                                            {alert.pairs_affected.slice(0, 3).map((pair, i) => (
                                                <Badge key={i} variant="outline" className="text-xs">
                                                    {pair}
                                                </Badge>
                                            ))}
                                            {alert.pairs_affected.length > 3 && (
                                                <Badge variant="outline" className="text-xs">
                                                    +{alert.pairs_affected.length - 3}
                                                </Badge>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        {alerts.length > 5 && (
                            <p className="text-xs text-gray-500 text-center pt-2">
                                ... and {alerts.length - 5} more alerts
                            </p>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}