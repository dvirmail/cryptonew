import Layout from "./Layout.jsx";

import Dashboard from "./Dashboard";

import TradeHistory from "./TradeHistory";

import Alerts from "./Alerts";

import TradeDetail from "./TradeDetail";

import Settings from "./Settings";

import Analytics from "./Analytics";

import Trading from "./Trading";

import Wallet from "./Wallet";

import Backtesting from "./Backtesting";

import BacktestingTest from "./BacktestingTest";

import BacktestDatabase from "./BacktestDatabase";

import CombinationStats from "./CombinationStats";

import DebugSettings from "./DebugSettings";

import SignalAnalysis from "./SignalAnalysis";

import OptedOutStrategies from "./OptedOutStrategies";

import SignalImplementationStatus from "./SignalImplementationStatus";

import SignalGuide from "./SignalGuide";

import SystemTest from "./SystemTest";

import BinanceSettings from "./BinanceSettings";

import LiveScanner from "./LiveScanner";

import RealTradingStrategies from "./RealTradingStrategies";

import datarecovery from "./datarecovery";

import AutoScan from "./AutoScan";

import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';

const PAGES = {
    
    Dashboard: Dashboard,
    
    TradeHistory: TradeHistory,
    
    Alerts: Alerts,
    
    TradeDetail: TradeDetail,
    
    Settings: Settings,
    
    Analytics: Analytics,
    
    Trading: Trading,
    
    Wallet: Wallet,
    
    Backtesting: Backtesting,
    
    BacktestingTest: BacktestingTest,
    
    BacktestDatabase: BacktestDatabase,
    
    CombinationStats: CombinationStats,
    
    DebugSettings: DebugSettings,
    
    SignalAnalysis: SignalAnalysis,
    
    OptedOutStrategies: OptedOutStrategies,
    
    SignalImplementationStatus: SignalImplementationStatus,
    
    SignalGuide: SignalGuide,
    
    SystemTest: SystemTest,
    
    BinanceSettings: BinanceSettings,
    
    LiveScanner: LiveScanner,
    
    RealTradingStrategies: RealTradingStrategies,
    
    datarecovery: datarecovery,
    
    AutoScan: AutoScan,
    
}

function _getCurrentPage(url) {
    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }
    let urlLastPart = url.split('/').pop();
    if (urlLastPart.includes('?')) {
        urlLastPart = urlLastPart.split('?')[0];
    }

    const pageName = Object.keys(PAGES).find(page => page.toLowerCase() === urlLastPart.toLowerCase());
    return pageName || Object.keys(PAGES)[0];
}

// Create a wrapper component that uses useLocation inside the Router context
function PagesContent() {
    const location = useLocation();
    const currentPage = _getCurrentPage(location.pathname);
    
    return (
        <Layout currentPageName={currentPage}>
            <Routes>            
                
                    <Route path="/" element={<Dashboard />} />
                
                
                <Route path="/Dashboard" element={<Dashboard />} />
                
                <Route path="/TradeHistory" element={<TradeHistory />} />
                
                <Route path="/Alerts" element={<Alerts />} />
                
                <Route path="/TradeDetail" element={<TradeDetail />} />
                
                <Route path="/Settings" element={<Settings />} />
                
                <Route path="/Analytics" element={<Analytics />} />
                
                <Route path="/Trading" element={<Trading />} />
                
                <Route path="/Wallet" element={<Wallet />} />
                
                <Route path="/Backtesting" element={<Backtesting />} />
                
                <Route path="/BacktestingTest" element={<BacktestingTest />} />
                
                <Route path="/BacktestDatabase" element={<BacktestDatabase />} />
                
                <Route path="/CombinationStats" element={<CombinationStats />} />
                
                <Route path="/DebugSettings" element={<DebugSettings />} />
                
                <Route path="/SignalAnalysis" element={<SignalAnalysis />} />
                
                <Route path="/OptedOutStrategies" element={<OptedOutStrategies />} />
                
                <Route path="/SignalImplementationStatus" element={<SignalImplementationStatus />} />
                
                <Route path="/SignalGuide" element={<SignalGuide />} />
                
                <Route path="/SystemTest" element={<SystemTest />} />
                
                <Route path="/BinanceSettings" element={<BinanceSettings />} />
                
                <Route path="/LiveScanner" element={<LiveScanner />} />
                
                <Route path="/RealTradingStrategies" element={<RealTradingStrategies />} />
                
                <Route path="/datarecovery" element={<datarecovery />} />
                
                <Route path="/AutoScan" element={<AutoScan />} />
                
            </Routes>
        </Layout>
    );
}

export default function Pages() {
    return (
        <Router>
            <PagesContent />
        </Router>
    );
}