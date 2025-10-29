
import React, { useState, useEffect, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Target, Shield, DollarSign, Clock, TrendingUp,
  Zap, BarChart3, Activity, SlidersHorizontal, Settings, AlertCircle
} from 'lucide-react';
import { queueEntityCall } from '@/components/utils/apiQueue';
import centralWalletStateManager from '@/components/services/CentralWalletStateManager';
import walletBalanceCache from '@/components/services/WalletBalanceCache';

const generateThematicName = (coin, signals, timeframe) => {
    const adjectives = ["Golden", "Silver", "Crystal", "Shadow", "Quantum", "Galactic", "Solar", "Lunar", "Cosmic", "Atomic", "Mystic", "Arctic", "Crimson", "Azure", "Emerald", "Obsidian", "Phantom", "Silent", "Iron", "Steel", "Diamond", "Vortex", "Abyss", "Zenith", "Apex", "Nova", "Pulse", "Echo", "Oracle", "Cipher", "Matrix", "Aegis", "Titan", "Spectre", "Warden", "Reaper", "Viper", "Cobra", "Phoenix", "Griffin", "Dragon", "Hydra", "Chimera", "Basilisk", "Wyvern", "Manticore", "Ronin", "Samurai", "Ninja", "Shinobi", "Shogun", "Daimyo", "Kensei", "Sensei", "Roshi", "Satori", "Kensho", "Zanshin"];
    const nouns = ["Eagle", "Wolf", "Lion", "Tiger", "Bear", "Shark", "Serpent", "Hawk", "Falcon", "Panther", "Jaguar", "Leopard", "Puma", "Coyote", "Fox", "Jackal", "Vulture", "Raven", "Crow", "Owl", "Condor", "Harbinger", "Sentinel", "Guardian", "Protector", "Vindicator", "Avenger", "Crusader", "Paladin", "Champion", "Warlord", "Conqueror", "Gladiator", "Executioner", "Vanquisher", "Destroyer", "Annihilator", "Obliterator", "Juggernaut", "Behemoth", "Leviathan", "Colossus", "Goliath", "Gargantua", "Monolith", "Maelstrom", "Tempest", "Cyclone", "Hurricane", "Tornado", "Tsunami", "Volcano", "Earthquake", "Avalanche", "Blizzard", "Thunder", "Lightning", "Storm", "Cataclysm", "Apocalypse", "Armageddon", "Ragnarok"];

    const starWarsAdjectives = ["Alderaanian", "Ancient", "Apprentice's", "Astromech", "Atollon", "Azure", "Bacta", "Bantha", "Beskar", "Black Sun", "Blaster-wielding", "Bounty-hunting", "Carbonite", "Chandrilan", "Chiss", "Clone", "Coaxium", "Commander's", "Corellian", "Coruscanti", "Cortosis", "Crimson Dawn", "Dathomirian", "Death Star", "Defiant", "Dreadnought", "Droid", "Durasteel", "Echo Base", "Endor", "Exegol", "Fallen", "Felucian", "First Order", "Force-sensitive", "Forgotten", "Galactic", "Geonosian", "Ghost", "Gungan", "Hidden", "Holocron", "Hoth", "Hutt", "Hyperdrive", "Imperial", "Interceptor", "Ionized", "Jakku", "Jawa", "Jedi", "Kaminoan", "Kashyyyk", "Kyber", "Lambda", "Lightsaber-wielding", "Lothal", "Mace", "Malachor", "Mandalorian", "Marauder", "Millennium", "Moisture-farming", "Mon Calamari", "Moraband", "Mustafarian", "Naboo", "Neimoidian", "Obsidian", "Outer Rim", "Padawan's", "Phantom", "Phrik", "Podracing", "Protocol", "Pyke", "Rebel", "Renegade", "Republic", "Resurgent", "Resistance", "Rodian", "Rogue", "Rylothian", "Scavenger", "Scoundrel's", "Separatist", "Shadow", "Sith", "Slave I", "Smuggler's", "Starkiller", "Stealth", "Stormtrooper", "Tatooine", "Tibanna", "Trade Federation", "Tusken", "Twi'lek", "Underworld", "Unwavering", "Vader's", "Vigilant", "Wookiee", "X-wing", "Y-wing", "Yavin", "Zabrak", "Zealous"];
    const starWarsNouns = ["Advantage", "Allegiance", "Ambush", "Annihilator", "Apparatus", "Arbitrator", "Archivist", "Ascendancy", "Assault", "Asset", "Banshee", "Barrage", "Basilisk", "Bastion", "Battle Droid", "Battlestation", "Blockade", "Boma", "Bowcaster", "Bulwark", "Campaign", "Cannonade", "Catalyst", "Cataclysm", "Centurion", "Chance", "Chancellor", "Charter", "Chimera", "Cipher", "Citadel", "Codex", "Cohort", "Collateral", "Comlink", "Commando", "Compulsor", "Confederacy", "Contingency", "Corsair", "Covenant", "Credence", "Crossfire", "Crusade", "Crusader", "CryoBan", "Datacron", "Datapad", "Dawn", "Decree", "Defender", "Defiance", "Deflector", "Dejarik", "Delegacy", "Deliverance", "Demolisher", "Designate", "Destiny", "Detonator", "Directive", "Disruptor", "Doctrine", "Dominance", "Dominion", "Doom", "Dragoons", "Dreadnought", "Droideka", "Dynasty", "Echelon", "Eclipse", "Edict", "E-11", "Elysium", "Embargo", "Emissary", "Empire", "Encounter", "Enforcer", "Enterprise", "Entity", "Eradicator", "Ewok", "Executor", "Exile", "Exodus", "Expedition", "Factor", "Falcon", "Firespray", "Fleet", "Foray", "Force", "Formation", "Fortress", "Freedom", "Fringe", "Gambit", "Garrison", "Gauntlet", "Ghost", "Grievous", "Guardian", "Gundark", "Hammerhead", "Harbinger", "Havoc", "Holocron", "Hope", "Hunter", "Hurricane", "Hush-98", "Hydra", "Hyperspace", "Incursion", "Inertia", "Infiltrator", "Infinity", "Initiative", "Inquisitor", "Interceptor", "Interdictor", "Intervention", "Intruder", "Invasion", "Ironclad", "Juggernaut", "Justicar", "Kessel Run", "Krayt Dragon", "Legacy", "Legion", "Leviathan", "Liberator", "Liberty", "Lightsaber", "Lineage", "Logic", "MagnaGuard", "Maneuver", "Manifesto", "Manticore", "Marauder", "Maul", "Mechanism", "Mediation", "Menace", "Mercy", "Meteor", "Midnight", "Mirage", "Mission", "Momentum", "Mythosaur", "Negotiator", "Nexus", "Nightfall", "Nightsister", "Nova", "Oath", "Obliterator", "Offensive", "Omega", "Omen", "Onslaught", "Operation", "Oppressor", "Oracle", "Order 66", "Outcry", "Outlander", "Outrider", "Overload", "Overseer", "Paladin", "Paradigm", "Paradox", "Paragon", "Patriot", "Patrol", "Peacekeeper", "Phantom", "Phenomenon", "Phoenix", "Pilgrim", "Pinnacle", "Pioneer", "Precedent", "Precursor", "Predator", "Presence", "Principle", "Prodigy", "Promise", "Prophecy", "Prospect", "Protocol", "Proton Torpedo", "Prowler", "Pursuit", "Quest", "Quasar", "Radiant VII", "Ragnarok", "Raider", "Rancor", "Ranger", "Rathtar", "Ravager", "Razor Crest", "Reaper", "Reckoning", "Reconnaissance", "Recourse", "Redemption", "Regiment", "Relic", "Remedy", "Remnant", "Rendezvous", "Renegade", "Resolve", "Response", "Retribution", "Revan", "Revelation", "Revenant", "Revenge", "Risk", "Ronin", "Sabacc", "Saber", "Sanctuary", "Sarlacc", "Scimitar", "Scion", "Scourge", "Scout", "Scythe", "Seeker", "Sentinel", "Shadow", "Shii-Cho", "Skirmish", "Skywalker", "Slave I", "Snare", "Solo", "Sorcery", "Soresu", "Sovereign", "Specter", "Squadron", "Stalker", "Stalwart", "Star Destroyer", "Stardust", "Starfighter", "Starhawk", "Starliner", "Stealth", "Storm", "Strategy", "Strike", "Supremacy", "Syndicate", "System", "Talon", "Tarkin", "Task Force", "Tempest", "Terminus", "Terror", "Theory", "Thrawn", "Threshold", "Thunder", "Titan", "Tracer", "Tractor Beam", "Tradition", "Tragedy", "Trandoshan", "Trident", "Triumph", "Trooper", "Tyranny", "Umbra", "Undertaking", "Union", "Unity", "Upheaval", "Uprising", "Vader", "Valiance", "Valor", "Vanguard", "Vanquisher", "Vector", "Vehemence", "Vengeance", "Venator", "Venture", "Vergence", "Vindicator", "Viper", "Virtue", "Vision", "Volley", "Vornskr", "Vortex", "Voyage", "Voyager", "Vulture Droid", "Wampa", "Warden", "Warlord", "Whisper", "Windu", "Wraith", "Xyston", "Yoda", "Zenith"];

    const allAdjectives = [...adjectives, ...starWarsAdjectives];
    const allNouns = [...nouns, ...starWarsNouns];

    // Simple hashing function to get a deterministic "random" choice based on inputs
    const getHash = (str) => {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash |= 0; // Convert to 32bit integer
        }
        return Math.abs(hash);
    };

    const combinedInput = `${coin}-${timeframe}-${signals.map(s => `${s.type}${s.value}`).join('')}`;
    const hash = getHash(combinedInput);

    const adjIndex = hash % allAdjectives.length;
    const nounIndex = (hash + adjIndex) % allNouns.length; // Offset noun choice

    const adj = allAdjectives[adjIndex];
    const noun = allNouns[nounIndex];

    return `${adj} ${noun} of ${coin.replace('/', '')}-${timeframe.toUpperCase()}`;
};

export default function WinStrategy({
  combination,
  initialStrategy = {},
  onStrategyChange = () => {},
  currentCoin,
  timeframe,
  defaultTab = 'atr',
  onTabChange = () => {}
}) {
  const [strategyType, setStrategyType] = useState(defaultTab);

  // WinStrategy now holds the comprehensive strategy state.
  // ATR parameters are now at the top level of the strategy object.
  const [strategy, setStrategy] = useState(() => {
    const initial = initialStrategy || {};
    return {
      // ATR-related parameters now directly on the strategy object
      riskPercentage: initial.riskPercentage ?? initial.atrAdaptive?.baseRiskPercentage ?? 1, // Default to 1%
      stopLossAtrMultiplier: initial.stopLossAtrMultiplier ?? initial.atrAdaptive?.stopLossMultiplier ?? 1.0, // Default to 1.0x for realistic short-term trading
      takeProfitAtrMultiplier: initial.takeProfitAtrMultiplier ?? initial.atrAdaptive?.takeProfitMultiplier ?? 1.5, // Default to 1.5x for realistic short-term trading
      // Traditional strategy parameters remain nested
      traditional: {
        positionSizePercentage: 1,
        stopLossPercentage: 2,
        takeProfitPercentage: 5,
        enableTrailingTakeProfit: false,
        trailingStopPercentage: 1,
        estimatedExitTimeMinutes: 240,
        ...initial.traditional,
      },
      // Merge any other top-level properties from initialStrategy, excluding old atrAdaptive
      ...Object.keys(initial).reduce((acc, key) => {
        if (key !== 'atrAdaptive' && key !== 'traditional' && ![
            'riskPercentage', 'stopLossAtrMultiplier', 'takeProfitAtrMultiplier'
        ].includes(key)) {
          acc[key] = initial[key];
        }
        return acc;
      }, {})
    };
  });

  const [walletBalance, setWalletBalance] = useState(0);
  const [loading, setLoading] = useState(true);

  // Fetch current wallet balance using cached service
  useEffect(() => {
    const initializeWalletBalance = async () => {
      try {
        setLoading(true);
        
        // Initialize the cache service if not already done
        walletBalanceCache.initialize(centralWalletStateManager);
        
        // Get cached balance immediately
        const cachedData = walletBalanceCache.getCachedBalance();
        if (cachedData.isValid) {
          setWalletBalance(cachedData.balance);
          setLoading(false);
        } else {
          // Cache is stale, refresh it
          await walletBalanceCache.refreshBalance();
          const refreshedData = walletBalanceCache.getCachedBalance();
          setWalletBalance(refreshedData.balance);
          setLoading(false);
        }
        
        // Subscribe to balance updates
        const unsubscribe = walletBalanceCache.subscribe((cacheData) => {
          setWalletBalance(cacheData.balance);
          setLoading(cacheData.isLoading);
        });
        
        // Cleanup subscription on unmount
        return unsubscribe;
        
      } catch (error) {
        console.error('[WinStrategy] ❌ Failed to initialize wallet balance:', error);
        setWalletBalance(0);
        setLoading(false);
      }
    };

    initializeWalletBalance();
  }, []); // Empty dependency array means it runs once on mount

  // Enhanced ATR strategy calculation with proper wallet consideration
  const calculateATRStrategy = useCallback(() => {
    // Return zeros if essential parameters are missing or invalid to prevent errors
    if (!currentCoin || walletBalance === 0 || strategy.riskPercentage === undefined || strategy.riskPercentage === null) {
      return {
        riskAmountUsd: 0,
        positionValueUsd: 0,
        stopLossUsd: 0,
        takeProfitUsd: 0,
        rewardRiskRatio: 0,
        score: 0,
        walletUtilization: 0,
        riskPercentage: strategy.riskPercentage ?? 0, // Ensure it's defined for display
      };
    }

    // Use actual wallet balance for risk calculation
    const riskAmountUsd = (walletBalance * (strategy.riskPercentage || 1)) / 100;

    // Simulate current market conditions (in real implementation, this would fetch live data for currentCoin and timeframe)
    // Example: For BTC, mock current price and ATR value
    const mockCurrentPrice = 50000; // Example: BTC price
    const mockAtrValue = mockCurrentPrice * 0.02; // Example: 2% ATR as a measure of volatility

    const stopLossMultiplier = strategy.stopLossAtrMultiplier || 2.5;
    const takeProfitMultiplier = strategy.takeProfitAtrMultiplier || 3.0;

    // Calculate stop loss distance in USD based on ATR
    const stopLossDistanceUsd = mockAtrValue * stopLossMultiplier;

    let cryptoQuantity = 0;
    if (stopLossDistanceUsd > 0) {
        // Calculate position size in crypto units: Risk Amount / Stop Loss Distance (in USD price points)
        cryptoQuantity = riskAmountUsd / stopLossDistanceUsd;
    }

    // Calculate total position value in USD
    const positionValueUsd = cryptoQuantity * mockCurrentPrice;

    // Calculate take profit value in USD based on ATR
    const takeProfitUsd = mockAtrValue * takeProfitMultiplier;

    // Reward:Risk Ratio calculation
    const rewardRiskRatio = stopLossDistanceUsd > 0 ? takeProfitUsd / stopLossDistanceUsd : 0;

    // Calculate a simple score based on reward-risk and risk percentage
    const score = Math.min(100, Math.max(0, (rewardRiskRatio * 15) + (strategy.riskPercentage * 5))); // A simple mock scoring system

    return {
      riskAmountUsd,
      positionValueUsd,
      stopLossUsd: stopLossDistanceUsd,
      takeProfitUsd,
      rewardRiskRatio,
      score,
      walletUtilization: walletBalance > 0 ? (positionValueUsd / walletBalance) * 100 : 0,
      riskPercentage: strategy.riskPercentage,
    };
  }, [currentCoin, strategy.riskPercentage, strategy.stopLossAtrMultiplier, strategy.takeProfitAtrMultiplier, walletBalance]); // Dependencies for useCallback

  const atrStrategy = calculateATRStrategy(); // Call the memoized function to get the latest ATR strategy details

  // NEW: Handler for changing strategy type (tabs) that also notifies the parent
  const handleStrategyTypeChange = (newType) => {
    setStrategyType(newType);
    if (onTabChange) {
      onTabChange(newType);
    }
  };

  // Generic handler for any strategy parameter changes from child components or inputs
  const handleLocalStrategyChange = (updatedFields) => {
    const newStrategy = { ...strategy }; // Create a mutable copy of the current strategy

    // Determine if the update is for the traditional sub-object or top-level ATR parameters
    if (updatedFields.traditional) {
      newStrategy.traditional = { ...newStrategy.traditional, ...updatedFields.traditional };
    } else {
      // For top-level ATR parameters (e.g., riskPercentage, stopLossAtrMultiplier), update directly
      Object.assign(newStrategy, updatedFields);
    }

    setStrategy(newStrategy); // Update the state
    if (onStrategyChange) {
      // Propagate the full updated strategy object up to the parent
      onStrategyChange(newStrategy);
    }
  };

  // Specific handler for traditional strategy changes (to directly update strategy.traditional)
  const handleTraditionalStrategyChange = (updatedFields) => {
    handleLocalStrategyChange({ traditional: updatedFields });
  };

  // Helper for formatting duration
  const formatDuration = (minutes) => {
    if (minutes < 60) {
      return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (remainingMinutes === 0) {
      return `${hours}h`;
    }
    return `${hours}h ${remainingMinutes}m`;
  };

  if (!combination) {
    return null;
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center">
          <Settings className="h-5 w-5 mr-2" />
          Advanced Trading Strategy
        </h3>
        {loading && (
          <div className="text-sm text-muted-foreground">Loading wallet data...</div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Choose between ATR-adaptive volatility-based sizing or traditional fixed parameters
        </p>
        <div className="text-sm text-muted-foreground">
          Wallet Balance: <span className="font-medium text-foreground">${walletBalance.toLocaleString()}</span>
        </div>
      </div>

      {/* Strategy Type Tabs */}
      <div className="flex rounded-lg bg-muted p-1">
        <button
          className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-all ${
            strategyType === 'atr'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => handleStrategyTypeChange('atr')}
        >
          <Zap className="h-4 w-4 mr-2 inline" />
          ATR Adaptive (Recommended)
        </button>
        <button
          className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-all ${
            strategyType === 'traditional'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => handleStrategyTypeChange('traditional')}
        >
          <BarChart3 className="h-4 w-4 mr-2 inline" />
          Traditional
        </button>
      </div>

      {/* ATR Adaptive Strategy Content */}
      {strategyType === 'atr' && (
        <div className="space-y-6">
          {/* Strategy Description */}
          <div className="p-4 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-lg">
            <div className="flex items-start space-x-3">
              <Zap className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
              <div>
                <h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-1">
                  ATR Adaptive Strategy
                </h4>
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  Automatically adjusts position size and risk management based on current market volatility.
                  Higher volatility = smaller positions. Lower volatility = larger positions within your risk tolerance.
                </p>
              </div>
            </div>
          </div>

          {/* ATR Trade Setup with wallet-aware calculations */}
          <div className="p-6 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/50 dark:to-indigo-950/50 border border-blue-200 dark:border-blue-800 rounded-lg">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <Zap className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                <h4 className="font-semibold text-blue-900 dark:text-blue-100">
                  ATR Adaptive Trade Setup
                </h4>
              </div>
              <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-300">
                Score: {Math.round(atrStrategy.score)}/100
              </Badge>
            </div>

            <div className="flex items-center justify-between mb-6">
              <p className="text-sm text-blue-700 dark:text-blue-300">
                Volatility-adjusted position sizing and risk management
              </p>
              <div className="text-sm text-blue-600 dark:text-blue-400">
                Risk: ${atrStrategy.riskAmountUsd.toFixed(2)} ({strategy.riskPercentage || 1}% of wallet)
              </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="text-center p-4 bg-white dark:bg-gray-800 rounded-lg border">
                <TrendingUp className="h-6 w-6 text-green-500 mx-auto mb-2" />
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  ${atrStrategy.positionValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-sm text-muted-foreground">Position Value</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {atrStrategy.walletUtilization?.toFixed(1)}% of wallet
                </div>
              </div>

              <div className="text-center p-4 bg-white dark:bg-gray-800 rounded-lg border">
                <Shield className="h-6 w-6 text-red-500 mx-auto mb-2" />
                <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                  ${atrStrategy.stopLossUsd.toFixed(2)}
                </div>
                <div className="text-sm text-muted-foreground">Stop Loss (price move)</div>
              </div>

              <div className="text-center p-4 bg-white dark:bg-gray-800 rounded-lg border">
                <Target className="h-6 w-6 text-blue-500 mx-auto mb-2" />
                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  ${atrStrategy.takeProfitUsd.toFixed(2)}
                </div>
                <div className="text-sm text-muted-foreground">Take Profit (price move)</div>
              </div>

              <div className="text-center p-4 bg-white dark:bg-gray-800 rounded-lg border">
                <TrendingUp className="h-6 w-6 text-purple-500 mx-auto mb-2" />
                <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                  {atrStrategy.rewardRiskRatio.toFixed(1)}:1
                </div>
                <div className="text-sm text-muted-foreground">Reward:Risk</div>
              </div>
            </div>
            {/* The Market Volatility Section from original code has been removed as per outline requirements. */}
          </div>

          {/* Risk Analysis with wallet context */}
          <div className="p-6 bg-white dark:bg-gray-800 border rounded-lg">
            <div className="flex items-center space-x-2 mb-4">
              <Shield className="h-5 w-5 text-orange-600 dark:text-orange-400" /> {/* Icon changed from AlertCircle to Shield */}
              <h4 className="font-semibold">Risk Analysis</h4>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <div className="text-sm text-muted-foreground mb-1">Risk Amount</div>
                <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                  ${atrStrategy.riskAmountUsd.toFixed(2)}
                </div>
                <div className="text-sm text-muted-foreground">
                  {strategy.riskPercentage || 1}% of ${walletBalance.toLocaleString()} wallet
                </div>
              </div>

              <div>
                <div className="text-sm text-muted-foreground mb-1">Potential Profit</div>
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  ${atrStrategy.takeProfitUsd.toFixed(2)}
                </div>
                <div className="text-sm text-muted-foreground">If take-profit hit</div>
              </div>

              <div>
                <div className="text-sm text-muted-foreground mb-1">Position Size</div>
                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {atrStrategy.walletUtilization?.toFixed(1)}%
                </div>
                <div className="text-sm text-muted-foreground">
                  Of total wallet ({atrStrategy.positionValueUsd > atrStrategy.riskAmountUsd ? 'Leveraged' : 'Conservative'})
                </div>
              </div>
            </div>

            <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
              <div className="text-sm text-muted-foreground">
                <strong>Base Risk Percentage:</strong> {strategy.riskPercentage || 1}% •
                <strong> Wallet Balance:</strong> ${walletBalance.toLocaleString()} •
                <strong> Max Risk:</strong> ${atrStrategy.riskAmountUsd.toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Traditional Strategy Content */}
      {strategyType === 'traditional' && (
        <div className="space-y-6">
          {/* Strategy Description */}
          <div className="p-4 bg-gray-50 dark:bg-gray-800 border rounded-lg">
            <div className="flex items-start space-x-3">
              <BarChart3 className="h-5 w-5 text-gray-600 dark:text-gray-400 mt-0.5 flex-shrink-0" />
              <div>
                <h4 className="font-semibold mb-1">Traditional Fixed Strategy</h4>
                <p className="text-sm text-muted-foreground">
                  Use fixed percentages for position sizing, stop-loss, and take-profit levels.
                  Consistent approach regardless of market volatility.
                </p>
              </div>
            </div>
          </div>

          {/* Traditional Controls */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <Label htmlFor="position-size">Position Size (% of Portfolio)</Label>
                <Input
                  id="position-size"
                  type="number"
                  value={strategy.traditional.positionSizePercentage}
                  onChange={(e) => handleTraditionalStrategyChange({ positionSizePercentage: parseFloat(e.target.value) || 1 })}
                  min="0.1"
                  max="100"
                  step="0.1"
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="stop-loss">Stop Loss (%)</Label>
                <Input
                  id="stop-loss"
                  type="number"
                  value={strategy.traditional.stopLossPercentage}
                  onChange={(e) => handleTraditionalStrategyChange({ stopLossPercentage: parseFloat(e.target.value) || 2 })}
                  min="0.1"
                  max="50"
                  step="0.1"
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="take-profit">Take Profit (%)</Label>
                <Input
                  id="take-profit"
                  type="number"
                  value={strategy.traditional.takeProfitPercentage}
                  onChange={(e) => handleTraditionalStrategyChange({ takeProfitPercentage: parseFloat(e.target.value) || 5 })}
                  min="0.1"
                  max="1000"
                  step="0.1"
                  className="mt-1"
                />
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <Label htmlFor="trailing-enabled">Enable Trailing Take Profit</Label>
                <div className="flex items-center space-x-2 mt-2">
                  <Switch
                    id="trailing-enabled"
                    checked={strategy.traditional.enableTrailingTakeProfit}
                    onCheckedChange={(checked) => handleTraditionalStrategyChange({ enableTrailingTakeProfit: checked })}
                  />
                  <span className="text-sm text-muted-foreground">
                    {strategy.traditional.enableTrailingTakeProfit ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              </div>

              {strategy.traditional.enableTrailingTakeProfit && (
                <div>
                  <Label htmlFor="trailing-percentage">Trailing Stop (%)</Label>
                  <Input
                    id="trailing-percentage"
                    type="number"
                    value={strategy.traditional.trailingStopPercentage}
                    onChange={(e) => handleTraditionalStrategyChange({ trailingStopPercentage: parseFloat(e.target.value) || 1 })}
                    min="0.1"
                    max="10"
                    step="0.1"
                    className="mt-1"
                  />
                </div>
              )}

              <div>
                <Label htmlFor="exit-time">Max Position Duration (minutes)</Label>
                <Input
                  id="exit-time"
                  type="number"
                  value={strategy.traditional.estimatedExitTimeMinutes}
                  onChange={(e) => handleTraditionalStrategyChange({ estimatedExitTimeMinutes: parseInt(e.target.value) || 240 })}
                  min="5"
                  max="10080"
                  step="5"
                  className="mt-1"
                />
              </div>
            </div>
          </div>

          {/* Traditional Strategy Preview */}
          <div className="p-4 bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-700 rounded-lg">
            <h4 className="font-semibold mb-3">Strategy Preview</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">Position Size</div>
                <div className="font-semibold">{strategy.traditional.positionSizePercentage}%</div>
              </div>
              <div>
                <div className="text-muted-foreground">Stop Loss</div>
                <div className="font-semibold text-red-600">{strategy.traditional.stopLossPercentage}%</div>
              </div>
              <div>
                <div className="text-muted-foreground">Take Profit</div>
                <div className="font-semibold text-green-600">{strategy.traditional.takeProfitPercentage}%</div>
              </div>
              <div>
                <div className="text-muted-foreground">Max Duration</div>
                <div className="font-semibold">{formatDuration(strategy.traditional.estimatedExitTimeMinutes)}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
