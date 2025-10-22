

import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { User } from "@/api/entities";
import { createPageUrl } from "./utils";
import { Link } from "react-router-dom";
import ScanTimer from "@/components/layout/ScanTimer";
import BitcoinPriceWidget from "@/components/layout/BitcoinPriceWidget";
import { getAutoScannerService } from '@/components/services/AutoScannerService';
import WalletStatusWidget from '@/components/layout/WalletStatusWidget';
import MarketRegimeWidget from '@/components/layout/MarketRegimeWidget';
import RegimeBlockingIndicator from '@/components/layout/RegimeBlockingIndicator';
import FearGreedWidget from '@/components/layout/FearGreedWidget';
import PerformanceMomentumWidget from "@/components/layout/PerformanceMomentumWidget";
import BalanceRiskWidget from '@/components/layout/BalanceRiskWidget'; // NEW: Import BalanceRiskWidget
import { initNetworkDebug } from "@/components/utils/networkDebug";

// Icons
import {
  ChevronDown,
  TrendingUp,
  LineChart,
  History,
  Settings,
  User as UserIconLucide,
  LogOut,
  AlertTriangle,
  Bell,
  Moon,
  Sun,
  CheckCircle2,
  Zap,
  Menu,
  X,
  Wallet as WalletIcon,
  Info,
  Rocket,
  ListChecks,
  BarChart3,
  BookOpen,
  Play,
  BarChart2,
  TestTube,
} from "lucide-react";

// UI Components
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

// Providers and Context
import { useToast } from '@/components/ui/use-toast';
import { WalletProvider } from '@/components/providers/WalletProvider';
import { LivePriceProvider, LivePriceContext } from '@/components/providers/LivePriceProvider';
import { TradingModeProvider, useTradingMode } from '@/components/providers/TradingModeProvider';

// Define navigation items
const initialMenuItems = [
  { name: "Dashboard", icon: BarChart3, path: "Dashboard" },
  {
    name: "Backtesting",
    icon: LineChart,
    path: "Backtesting",
    submenu: [
      { name: "Run Backtest", path: createPageUrl("Backtesting") },
      { name: 'Backtest Database', path: createPageUrl('BacktestDatabase') },
      { name: 'Signal Status', path: createPageUrl('SignalImplementationStatus') }
    ]
  },
  { name: "Signal Guide", icon: BookOpen, path: "SignalGuide" },
  { name: "Scanner", icon: Play, path: "AutoScan" }, // CHANGED: point to AutoScan
  { name: "Trading", icon: TrendingUp, path: "Trading" },
  { name: "Wallet", icon: WalletIcon, path: "Wallet" },
  {
    name: "Trade History",
    icon: History,
    path: "TradeHistory",
    submenu: [
      { name: "Trade Log", path: createPageUrl("TradeHistory") },
      { name: "Combination Stats", path: createPageUrl("CombinationStats") },
      { name: "Real Trading Strategies", path: createPageUrl("RealTradingStrategies") },
      { name: "Opted-Out Strategies", path: createPageUrl("OptedOutStrategies") },
      { name: "Data Recovery", path: createPageUrl("datarecovery") }
    ]
  },
  { name: "Analytics", icon: BarChart2, path: "Analytics" },
  { name: "Alerts", icon: Bell, path: "Alerts" },
];

// The actual UI for the layout
function AppLayout({ children, currentPageName }) {
  const [user, setUser] = useState(null);
  const [menuItems, setMenuItems] = useState(initialMenuItems);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [openSubmenu, setOpenSubmenu] = useState(null);
  const [connectionError, setConnectionError] = useState(false);
  
  // NEW: Get mode from context
  const { isLiveMode, toggleMode } = useTradingMode();
  
  const { toast } = useToast();
  const navigate = useNavigate();

  // Subscribe to AutoScannerService for performance momentum and price updates
  const [scannerState, setScannerState] = useState(null); // NEW: State to hold the full scanner state
  const { updatePricesFromScanner } = React.useContext(LivePriceContext);
  
  // Define a local logging function for this component's context
  // This helps centralize internal log messages, potentially integrating with a broader logging system or UI notifications.
  const addLog = (message, type) => {
    console.log(`[${type}] ${message}`);
    // Example: If you wanted these logs to show as toasts to the user:
    // toast({
    //   title: `System Log (${type})`,
    //   description: message,
    //   duration: 3000, // Short duration for system messages
    // });
  };

  // Install liveTradingAPI network debugger once app mounts
  useEffect(() => {
    initNetworkDebug();
  }, []); // Empty dependency array means this runs once on mount


  useEffect(() => {
    if (typeof window !== 'undefined') {
      const scannerService = getAutoScannerService();
      
      // Ensure the service is initialized if it hasn't been yet
      if (!scannerService.getState().isInitialized) {
          scannerService.initialize();
      }

      // Handler for scanner state updates (e.g., performance momentum)
      const handleUpdate = (state) => {
        setScannerState(state); // Update the full scanner state
      };

      // Subscribe to scanner service state changes
      const unsubscribe = scannerService.subscribe(handleUpdate);
      
      // Register callbacks for LivePriceProvider and toast notifications
      scannerService.registerPriceUpdateCallback(updatePricesFromScanner);
      scannerService.registerToastNotifier(toast);
      
      // Get initial state immediately
      handleUpdate(scannerService.getState());
      
      // Cleanup on unmount
      return () => {
        unsubscribe();
        scannerService.unregisterPriceUpdateCallback(updatePricesFromScanner);
        // Do not unregister toast notifier here if it's meant to persist across layout remounts
        // Or if the service handles its own unregistration based on a lifecycle event.
        // For simplicity, keeping it as is, assuming registerNotifier handles duplicates or is fine.
      };
    }
  }, [toast, updatePricesFromScanner]); // Dependencies: toast and the price update function

  useEffect(() => {
    const loadUser = async () => {
      try {
        setConnectionError(false); // Reset error state on new attempt
        const currentUser = await User.me();
        setUser(currentUser);
        
        if (currentUser.role === 'admin') {
          const adminItems = [
            { name: "Settings", icon: Settings, path: "Settings" },
            { name: "Binance Settings", icon: Settings, path: "BinanceSettings" },
            { name: "Debug Settings", icon: Info, path: "DebugSettings" }
          ];
          setMenuItems([...initialMenuItems, ...adminItems]);
        } else {
          const userItems = [
            { name: "Binance Settings", icon: Settings, path: "BinanceSettings" }
          ];
          setMenuItems([...initialMenuItems, ...userItems]);
        }
      } catch (error) {
        console.error("Error loading user:", error);
        setConnectionError(true); // Indicate connection error
        setMenuItems(initialMenuItems); // Fallback to default menu items
        
        // Set a fallback user object to prevent app crash
        setUser({
          full_name: 'Offline User',
          email: 'offline@local.dev',
          role: 'user'
        });
        
        toast({
          title: "Connection Issue",
          description: "Running in offline mode. Some features may be limited.",
          variant: "destructive",
        });
      }
    };
    loadUser();
  }, [toast]);

  // Effect to manage the dark mode class based on state
  useEffect(() => {
    const root = document.documentElement;
    if (isDarkMode) {
        root.classList.add('dark');
    } else {
        root.classList.remove('dark');
    }
  }, [isDarkMode]);

  const handleLogout = async () => {
    try {
      const scannerService = getAutoScannerService();
      if (scannerService.getState().isRunning) {
          scannerService.stop(); // The stop method now handles releasing the session.
          // It's synchronous, so no await is needed here.
          addLog("Scanner stopped on logout.", "system");
      }
      await User.logout();
      navigate('/');
    } catch (error) {
      console.error('Error logging out:', error);
      // Fallback: Clear local state and redirect anyway if logout fails due to network or other issues
      setUser(null);
      window.location.href = '/'; // Force a full page reload to clear state and redirect
    }
  };

  const toggleDarkMode = () => {
    setIsDarkMode(prev => !prev);
  };

  const toggleSubmenu = (itemName) => {
    setOpenSubmenu(openSubmenu === itemName ? null : itemName);
  };

  return (
    <>
      {/* CSS Overrides to Force Light Theme on Mobile */}
      <style>{`
        @media (max-width: 1023px) {
          /* Force light background and text on the main body */
          body,
          .flex.h-screen.bg-gray-50.dark\\:bg-gray-900 {
            background-color: #F9FAFB !important; /* bg-gray-50 */
            color: #111827 !important; /* text-gray-900 */
          }

          /* Force light theme for all major components when dark class is active */
          html.dark .bg-white.dark\\:bg-gray-800,
          html.dark .bg-card,
          html.dark nav.dark\\:bg-gray-800,
          html.dark header.dark\\:bg-gray-800,
          html.dark .bg-gray-100.dark\\:bg-gray-700 {
            background-color: #FFFFFF !important;
            color: #1F2937 !important;
            border-color: #E5E7EB !important;
          }

          /* Force light borders when dark class is active */
          html.dark .border-b.dark\\:border-gray-700,
          html.dark .border-r.dark\\:border-gray-700,
          html.dark .border-t.dark\\:border-gray-700 {
            border-color: #E5E7EB !important; /* Equivalent of border-gray-200 */
          }
          
          /* Force dark text color when dark class is active */
          html.dark .text-gray-900.dark\\:text-white,
          html.dark .text-gray-900.dark\\:text-gray-100,
          html.dark .text-gray-600.dark\\:text-gray-300,
          html.dark .text-gray-500.dark\\:text-gray-400,
          html.dark h1.dark\\:text-white,
          html.dark h2.dark\\:text-white,
          html.dark h3.dark\\:text-white,
          html.dark p.dark\\:text-white,
          html.dark span.dark\\:text-gray-400 {
             color: #374151 !important; /* text-gray-700 */
          }

          /* Specific overrides for buttons/links in dark mode on mobile */
          html.dark .text-blue-700.dark\\:text-blue-300,
          html.dark .bg-blue-100.dark\\:bg-blue-900 {
            color: #1D4ED8 !important; /* text-blue-700 */
            background-color: #DBEAFE !important; /* bg-blue-100 */
          }
          html.dark .hover\\:text-gray-900.dark\\:hover\\:text-white:hover {
            color: #1F2937 !important; /* hover:text-gray-900 */
          }
          html.dark .hover\\:bg-gray-100.dark\\:hover\\:bg-gray-700:hover {
            background-color: #F3F4F6 !important; /* hover:bg-gray-100 */
          }
          html.dark .dark\\:border-gray-700 {
            border-color: #E5E7EB !important;
          }

          /* Special treatment for mobile dark mode toggle */
          #mobile-dark-mode-toggle {
            cursor: not-allowed;
            opacity: 0.5;
          }
        }
        /* Custom scrollbar hide utility class */
        .no-scrollbar::-webkit-scrollbar {
            display: none;
        }
        .no-scrollbar {
            -ms-overflow-style: none;  /* IE and Edge */
            scrollbar-width: none;  /* Firefox */
        }
      `}</style>
      
      <div className={`flex h-screen bg-gray-50 dark:bg-gray-900`}>
        {/* Connection Error Banner */}
        {connectionError && (
          <div className="fixed top-0 left-0 right-0 bg-yellow-500 text-white px-4 py-2 text-center text-sm z-50">
            <AlertTriangle className="inline h-4 w-4 mr-2" />
            Connection issues detected - App running in offline mode
          </div>
        )}

        {/* Sidebar */}
        <nav className={`
          ${isMobileMenuOpen ? 'block fixed' : 'hidden'} lg:block 
          bg-white dark:bg-gray-800 w-64 border-r border-gray-200 dark:border-gray-700 
          flex-shrink-0 z-50 lg:z-auto overflow-y-auto
          ${connectionError ? 'mt-10' : ''}
        `}>
          {/* Sidebar Header for Mobile */}
          <div className="flex items-center justify-between p-4 h-[69px] border-b dark:border-gray-700 lg:hidden">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Menu</h2>
            <Button variant="ghost" size="icon" onClick={() => setIsMobileMenuOpen(false)}>
              <X className="h-5 w-5" />
            </Button>
          </div>
          {/* Sidebar Content */}
          <div className="p-4 space-y-2">
             {menuItems.map((item) => (
                <div key={item.name}>
                  {item.submenu ? (
                    <div>
                      <Button
                        variant="ghost"
                        className="w-full justify-between text-left font-normal"
                        onClick={() => toggleSubmenu(item.name)}
                      >
                        <div className="flex items-center">
                          <item.icon className="mr-2 h-4 w-4" />
                          {item.name}
                        </div>
                        <ChevronDown className={`h-4 w-4 transition-transform ${openSubmenu === item.name ? 'rotate-180' : ''}`} />
                      </Button>
                      {openSubmenu === item.name && (
                        <div className="ml-6 mt-2 space-y-1">
                          {item.submenu.map((subItem) => (
                            <Link
                              key={subItem.name}
                              to={subItem.path}
                              className="block px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
                              onClick={() => setIsMobileMenuOpen(false)}
                            >
                              {subItem.name}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <Link
                      to={createPageUrl(item.path)}
                      className={`flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                        currentPageName === item.path
                          ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                          : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      <item.icon className="mr-3 h-5 w-5" />
                      {item.name}
                    </Link>
                  )}
                </div>
              ))}
          </div>
        </nav>

        {/* Mobile overlay */}
        {isMobileMenuOpen && (
          <div
            className="fixed inset-0 bg-gray-600 bg-opacity-75 z-40 lg:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-y-auto">
          {/* Header */}
          <header className={`bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-30 ${connectionError ? 'mt-10' : ''}`}>
            {/* Top Bar: Controls, App Title, User Menu */}
            <div className="flex items-center justify-between px-4 py-3">
              {/* Left Group: Mobile Menu Toggle & Desktop Live/Testnet Toggle */}
              <div className="flex items-center space-x-2">
                <Button // Mobile menu button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                  className="lg:hidden text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  <Menu className="h-6 w-6" />
                </Button>

                {/* Desktop Live/Testnet Toggle */}
                <div className="hidden lg:flex items-center space-x-2 bg-gray-100 dark:bg-gray-700 rounded-lg px-3 py-2">
                  <TestTube className="h-4 w-4 text-blue-600" />
                  <Label htmlFor="mode-toggle" className="text-sm font-medium cursor-pointer">
                    Testnet
                  </Label>
                  <Switch
                    id="mode-toggle"
                    checked={isLiveMode}
                    onCheckedChange={toggleMode}
                  />
                  <Label htmlFor="mode-toggle" className="text-sm font-medium cursor-pointer">
                    Live
                  </Label>
                  <TrendingUp className="h-4 w-4 text-green-600" />
                </div>
              </div>

              {/* Center Group: App Name & Mode Badge */}
              <div className="flex items-center space-x-2">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                  CryptoSentinel
                </h1>
                <span className="text-sm text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                  v9.0
                </span>
                <Badge className={`text-xs font-semibold ${isLiveMode ? 'bg-green-500 text-white' : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'}`}>
                  {isLiveMode ? 'LIVE' : 'TESTNET'}
                </Badge>
              </div>

              {/* Right Group: Desktop/Mobile Dark Mode & User Dropdown */}
              <div className="flex items-center space-x-2">
                {/* Desktop Dark Mode Toggle */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleDarkMode}
                  className="hidden lg:flex text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  {isDarkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                </Button>
                {/* Mobile Dark Mode Toggle (disabled) */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => toast({ 
                    title: "Light Theme Active", 
                    description: "Dark mode is disabled for the mobile layout to ensure readability.",
                    duration: 3000,
                  })}
                  className="lg:hidden text-gray-500 hover:text-gray-700"
                  id="mobile-dark-mode-toggle"
                >
                  <Moon className="h-5 w-5" />
                </Button>
                
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src="/placeholder-avatar.jpg" alt={user?.full_name || 'User'} />
                        <AvatarFallback className="bg-blue-600 text-white">
                          {user?.full_name?.charAt(0) || 'U'}
                        </AvatarFallback>
                      </Avatar>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-56" align="end" forceMount>
                    <DropdownMenuLabel className="font-normal">
                      <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium leading-none">{user?.full_name || 'User'}</p>
                        <p className="text-xs leading-none text-muted-foreground">{user?.email}</p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleLogout}>
                      <LogOut className="mr-2 h-4 w-4" />
                      <span>Log out</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Wallet Widget and Page Title Bar (Updated) */}
            <div className="flex items-center justify-center p-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 overflow-x-auto no-scrollbar">
                <div className="flex items-center gap-4 shrink-0">
                    <WalletStatusWidget />
                    <BitcoinPriceWidget />
                    <BalanceRiskWidget scannerState={scannerState} />
                    <PerformanceMomentumWidget 
                        performanceMomentumScore={scannerState?.performanceMomentumScore}
                        momentumBreakdown={scannerState?.momentumBreakdown}
                        isScanning={scannerState?.isScanning}
                        isRunning={scannerState?.isRunning}
                        // NEW: pass the configured base minimum conviction from settings
                        baseMinimumConviction={scannerState?.settings?.minimumConvictionScore}
                    />
                    <FearGreedWidget />
                    <MarketRegimeWidget />
                    <RegimeBlockingIndicator />
                    <ScanTimer />
                </div>
            </div>
          </header>

          {/* Page Content */}
          <main className="flex-1 p-4 sm:p-6 lg:p-8">
            {children}
          </main>
        </div>
      </div>
    </>
  );
}

// Main export with providers
export default function Layout({ children, currentPageName }) {
    return (
        <TradingModeProvider>
            <WalletProvider>
                <LivePriceProvider>
                    <AppLayout currentPageName={currentPageName}>
                        {children}
                    </AppLayout>
                </LivePriceProvider>
            </WalletProvider>
        </TradingModeProvider>
    );
}

