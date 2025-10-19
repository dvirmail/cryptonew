
import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { saveApiKeys } from '@/api/functions';
import { testBinanceKeys } from '@/api/functions';
import { queueEntityCall } from '@/api/functions/queueEntityCall'; // New import for fetching user data
import { ScanSettings } from '@/api/entities';
import { Loader2, Info, Server, CheckCircle, AlertTriangle } from 'lucide-react';

export default function BinanceSettings() {
    const { toast } = useToast();
    const [liveApiKey, setLiveApiKey] = useState('');
    const [liveApiSecret, setLiveApiSecret] = useState('');
    const [testnetApiKey, setTestnetApiKey] = useState('');
    const [testnetApiSecret, setTestnetApiSecret] = useState('');
    const [localProxyUrl, setLocalProxyUrl] = useState('');
    
    const [isSaving, setIsSaving] = useState(false);
    // isTesting state is replaced by more granular testStatus
    const [isLoading, setIsLoading] = useState(true);
    const [settingsId, setSettingsId] = useState(null);
    // New state to track the testing status for live and testnet independently
    const [testStatus, setTestStatus] = useState({ live: 'idle', testnet: 'idle' }); // 'idle', 'testing', 'success', 'error'

    // Function to load API keys, wrapped in useCallback to prevent re-creation
    const loadApiKeys = useCallback(async () => {
        try {
            // Assuming queueEntityCall('User', 'me') returns the user object directly
            const user = await queueEntityCall('User', 'me');
            const keys = user?.binance_api_keys || {};
            setLiveApiKey(keys.liveApiKey || '');
            setLiveApiSecret(keys.liveApiSecret || '');
            setTestnetApiKey(keys.testnetApiKey || '');
            setTestnetApiSecret(keys.testnetApiSecret || '');
        } catch (error) {
            toast({
                title: 'Error',
                description: `Failed to load API keys: ${error.message}`,
                variant: 'destructive'
            });
        }
    }, [toast]);

    // Combined useEffect for initial loading of both ScanSettings and API keys
    useEffect(() => {
        const initialLoad = async () => {
            setIsLoading(true);
            try {
                // Load ScanSettings
                const settingsList = await ScanSettings.list();
                if (settingsList.length > 0) {
                    const settings = settingsList[0];
                    setSettingsId(settings.id);
                    // Set local proxy URL, with a default fallback if not configured
                    setLocalProxyUrl(settings.local_proxy_url || 'https://ed1de3b343fc.ngrok.app');
                }

                // Load API keys using the useCallback function
                await loadApiKeys();

            } catch (error) {
                toast({
                    title: 'Error',
                    description: `Failed to load configurations: ${error.message}`,
                    variant: 'destructive'
                });
            } finally {
                setIsLoading(false);
            }
        };
        initialLoad();
    }, [toast, loadApiKeys]); // Depend on toast and loadApiKeys

    const handleSave = async () => {
        setIsSaving(true);
        try {
            // Save API keys to secure storage
            const saveKeysResult = await saveApiKeys({
                liveApiKey,
                liveApiSecret,
                testnetApiKey,
                testnetApiSecret,
            });

            if (!saveKeysResult?.data?.success) {
                throw new Error(saveKeysResult?.data?.message || 'Failed to save API keys.');
            }

            // Save the local proxy URL to the ScanSettings entity
            if (settingsId) {
                await ScanSettings.update(settingsId, { local_proxy_url: localProxyUrl });
            } else {
                const newSettings = await ScanSettings.create({ local_proxy_url: localProxyUrl });
                setSettingsId(newSettings.id);
            }

            toast({
                title: 'Success',
                description: 'Settings saved successfully. API keys are encrypted.',
                variant: 'success'
            });
        } catch (error) {
            toast({
                title: 'Error',
                description: `Failed to save settings: ${error.message}`,
                variant: 'destructive',
            });
        } finally {
            setIsSaving(false);
        }
    };

    // Renamed from handleTestConnection to handleTestKeys for consistency with outline
    const handleTestKeys = async (mode) => {
        setTestStatus(prev => ({ ...prev, [mode]: 'testing' })); // Set status to testing for the specific mode
        try {
            // It's crucial to save any currently entered keys first,
            // as the `testBinanceKeys` function on the server will rely on the latest saved keys.
            await saveApiKeys({ liveApiKey, liveApiSecret, testnetApiKey, testnetApiSecret });

            // FIXED: Fetch settings to get the proxy URL dynamically
            // This ensures we always use the most recently saved proxy URL.
            const settingsList = await ScanSettings.list();
            const settings = settingsList[0]; // Assuming there's at least one settings entry
            if (!settings?.local_proxy_url) {
                throw new Error("Local Proxy URL not configured in settings. Please save it first.");
            }
            const currentProxyUrl = settings.local_proxy_url;

            // FIXED: Pass the proxy URL from settings to the test function
            const { data } = await testBinanceKeys({
                mode,
                proxyUrl: currentProxyUrl // Centralized proxy URL usage
            });
            
            if (data.success) {
                setTestStatus(prev => ({ ...prev, [mode]: 'success' }));
                toast({
                    title: `${mode.charAt(0).toUpperCase() + mode.slice(1)} Test Successful`,
                    description: data.message,
                    variant: 'success',
                });
            } else {
                throw new Error(data.message);
            }
        } catch (error) {
            setTestStatus(prev => ({ ...prev, [mode]: 'error' }));
            toast({
                title: `${mode.charAt(0).toUpperCase() + mode.slice(1)} Test Failed`,
                description: error.message,
                variant: 'destructive',
            });
        }
        // No finally block needed here, as setTestStatus is handled in try/catch for each outcome
    };

    if (isLoading) {
        return <div className="flex justify-center items-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    return (
        <div className="p-4 md:p-8 space-y-8">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Server className="h-6 w-6" /> Local Proxy Server Configuration</CardTitle>
                    <CardDescription>Configure the connection to your local proxy server for trade execution.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Alert>
                        <Info className="h-4 w-4" />
                        <AlertTitle>How It Works</AlertTitle>
                        <AlertDescription>
                            <p>For security, all trade commands are sent from our cloud servers to your local proxy server. Your local server then executes the trade with Binance using your API keys.</p>
                            <p className="mt-2 font-semibold">To make this work, your local server must be accessible from the internet.</p>
                        </AlertDescription>
                    </Alert>

                    <div className="p-4 border-l-4 border-blue-500 bg-blue-50 dark:bg-blue-900/20">
                        <h4 className="font-bold text-lg mb-2">Setup Instructions</h4>
                        <ol className="list-decimal list-inside space-y-2">
                            <li>Download and run the `server.js` file on your PC.</li>
                            <li>Use a tunneling service like <a href="https://ngrok.com/download" target="_blank" rel="noopener noreferrer" className="underline font-medium">ngrok</a> to expose your local port 3001.</li>
                            <li>Run this command in your terminal: <code className="bg-gray-200 dark:bg-gray-700 p-1 rounded">ngrok http 3001</code></li>
                            <li>Copy the public HTTPS URL provided by ngrok (e.g., `https://random-string.ngrok.io`).</li>
                            <li>Paste that public URL into the field below and save.</li>
                        </ol>
                    </div>

                    <div>
                        <Label htmlFor="localProxyUrl">Local Proxy Server Public URL</Label>
                        <Input
                            id="localProxyUrl"
                            value={localProxyUrl}
                            onChange={(e) => setLocalProxyUrl(e.target.value)}
                            placeholder="https://ed1de3b343fc.ngrok.app"
                        />
                        <p className="text-sm text-gray-500 mt-1">This must be the public URL from your tunneling service (e.g., ngrok).</p>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Binance API Keys</CardTitle>
                    <CardDescription>
                        Enter your Binance API keys. They will be encrypted and stored securely. 
                        They are only used by the local proxy running on your machine.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* Live Keys */}
                    <div className="space-y-4 p-4 border rounded-lg">
                        <h3 className="font-medium text-lg">Live Account</h3>
                        <div>
                            <Label htmlFor="live-api-key">Live API Key</Label>
                            <Input id="live-api-key" type="password" placeholder="Enter your live API key" value={liveApiKey} onChange={(e) => setLiveApiKey(e.target.value)} />
                        </div>
                        <div>
                            <Label htmlFor="live-api-secret">Live API Secret</Label>
                            <Input id="live-api-secret" type="password" placeholder="Enter your live API secret" value={liveApiSecret} onChange={(e) => setLiveApiSecret(e.target.value)} />
                        </div>
                        <Button onClick={() => handleTestKeys('live')} disabled={testStatus.live === 'testing'}>
                            {testStatus.live === 'testing' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {testStatus.live === 'success' && <CheckCircle className="mr-2 h-4 w-4 text-green-500" />}
                            {testStatus.live === 'error' && <AlertTriangle className="mr-2 h-4 w-4 text-red-500" />}
                            Test Live Connection
                        </Button>
                    </div>

                    {/* Testnet Keys */}
                    <div className="space-y-4 p-4 border rounded-lg">
                        <h3 className="font-medium text-lg">Testnet Account</h3>
                        <div>
                            <Label htmlFor="testnet-api-key">Testnet API Key</Label>
                            <Input id="testnet-api-key" type="password" placeholder="Enter your testnet API key" value={testnetApiKey} onChange={(e) => setTestnetApiKey(e.target.value)} />
                        </div>
                        <div>
                            <Label htmlFor="testnet-api-secret">Testnet API Secret</Label>
                            <Input id="testnet-api-secret" type="password" placeholder="Enter your testnet API secret" value={testnetApiSecret} onChange={(e) => setTestnetApiSecret(e.target.value)} />
                        </div>
                        <Button onClick={() => handleTestKeys('testnet')} disabled={testStatus.testnet === 'testing'}>
                            {testStatus.testnet === 'testing' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {testStatus.testnet === 'success' && <CheckCircle className="mr-2 h-4 w-4 text-green-500" />}
                            {testStatus.testnet === 'error' && <AlertTriangle className="mr-2 h-4 w-4 text-red-500" />}
                            Test Testnet Connection
                        </Button>
                    </div>

                    <div className="flex justify-end">
                        <Button onClick={handleSave} disabled={isSaving}>
                            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Save All Settings
                        </Button>
                    </div>
                </CardContent>
            </Card>

             <Card>
                <CardHeader>
                    <CardTitle>Corrected `server.js` for Local Proxy</CardTitle>
                    <CardDescription>
                        Use this code for your local `server.js` file. It loads keys from a `.env` file for better security.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <pre className="bg-gray-100 dark:bg-gray-800 p-4 rounded-md text-xs overflow-auto">
                        <code>
{`
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
const PORT = 3001;

app.use(cors()); // Enable CORS for all routes
app.use(bodyParser.json());

const apiKeys = {
    live: {
        key: process.env.BINANCE_LIVE_API_KEY,
        secret: process.env.BINANCE_LIVE_API_SECRET
    },
    testnet: {
        key: process.env.BINANCE_TESTNET_API_KEY,
        secret: process.env.BINANCE_TESTNET_API_SECRET
    }
};

const API_URLS = {
    live: 'https://api.binance.com',
    testnet: 'https://testnet.binance.vision'
};

async function makeSignedRequest(endpoint, method = 'POST', params = {}, config) {
    const { mode } = config;
    const credentials = apiKeys[mode];
    if (!credentials || !credentials.key || !credentials.secret) {
        throw new Error(\`API keys for \${mode} mode are not configured in the .env file.\`);
    }

    const baseUrl = API_URLS[mode];
    const timestamp = Date.now();
    const signatureParams = { ...params, timestamp };
    const queryString = new URLSearchParams(signatureParams).toString();

    const signature = crypto.createHmac('sha256', credentials.secret)
        .update(queryString)
        .digest('hex');

    const url = \`\${baseUrl}\${endpoint}?\${queryString}&signature=\${signature}\`;

    console.log(\`[\${new Date().toISOString()}] Making request to Binance: \${method} \${url}\`);

    try {
        const response = await axios({
            method: method,
            url: url,
            headers: { 'X-MBX-APIKEY': credentials.key }
        });
        return response.data;
    } catch (error) {
        const errorDetails = error.response ? error.response.data : { msg: error.message };
        console.error('Error from Binance:', errorDetails);
        throw new Error(JSON.stringify(errorDetails));
    }
}

app.post('/trading', async (req, res) => {
    console.log(\`[\${new Date().toISOString()}] Received request from cloud function:\`, req.body);
    
    const { action, tradingMode, positionData } = req.body;

    if (!action || !tradingMode || !positionData) {
        return res.status(400).json({ success: false, message: 'Missing required fields in request.' });
    }
    
    try {
        let result;
        if (action === 'openPosition') {
            const { symbol, entry_value_usdt } = positionData;
            const binanceSymbol = symbol.replace('/', '');
            
            result = await makeSignedRequest(
                '/api/v3/order', 
                'POST', 
                {
                    symbol: binanceSymbol,
                    side: 'BUY',
                    type: 'MARKET',
                    quoteOrderQty: entry_value_usdt.toFixed(2), // Ensure quote order quantity has correct precision
                },
                { mode: tradingMode }
            );

        } else if (action === 'getAccountInfo') {
             result = await makeSignedRequest(
                '/api/v3/account',
                'GET',
                {},
                { mode: tradingMode }
            );
        } else if (action === 'closeAllPositions') {
            // Note: This is a placeholder. A real 'close all' would need to query open positions first.
            console.log('Simulating close all positions...');
            result = { success: true, message: 'Simulated closing all positions.', positionsClosed: 0 };
        } else {
            throw new Error(\`Unsupported action: \${action}\`);
        }
        
        res.json({ success: true, data: result });

    } catch (error) {
        console.error('Error processing trade request:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.listen(PORT, () => {
    console.log(\`Local Binance Proxy Server running on http://localhost:\${PORT}\`);
    if(!apiKeys.testnet.key || !apiKeys.testnet.secret) {
        console.warn('⚠️ Testnet API keys are not set in your .env file.');
    }
    if(!apiKeys.live.key || !apiKeys.live.secret) {
        console.warn('⚠️ Live API keys are not set in your .env file.');
    }
});

// Create a .env file in the same directory with this content:
/*
BINANCE_LIVE_API_KEY=your_live_key
BINANCE_LIVE_API_SECRET=your_live_secret
BINANCE_TESTNET_API_KEY=your_testnet_key
BINANCE_TESTNET_API_SECRET=your_testnet_secret
*/
`}
                        </code>
                    </pre>
                </CardContent>
            </Card>
        </div>
    );
}
