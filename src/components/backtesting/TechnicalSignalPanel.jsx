
import React from 'react';
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from '@/components/ui/badge';
import { SlidersHorizontal, TrendingUp, Activity, Zap, BarChart3, Layers, Eye, ChevronDown } from 'lucide-react';
import { SIGNAL_CATEGORIES } from '../utils/signalSettings';

const ICONS = { TrendingUp, Activity, Zap, BarChart3, Layers, Eye };

const TechnicalSignalPanel = ({
  signalSettings,
  onSignalEnabledChange,
  onSignalParameterChange,
  openAccordions,
  onAccordionChange,
}) => {

  const getGroupStats = (groupSignals) => {
    if (!groupSignals || !Array.isArray(groupSignals)) return { enabled: 0, total: 0 };
    const visibleSignals = groupSignals.filter(signal => !signalSettings[signal]?.hidden);
    const enabled = visibleSignals.filter(signal => signalSettings[signal]?.enabled).length;
    return { enabled, total: visibleSignals.length };
  };

  const toggleSignalGroup = (groupSignals, enable) => {
    groupSignals.forEach(signalKey => {
      const settings = signalSettings[signalKey];
      if (settings && !settings.hidden && typeof onSignalEnabledChange === 'function') {
        onSignalEnabledChange(signalKey, enable);
      }
    });
  };
  
  const renderSignalControl = (signalKey) => {
    const settings = signalSettings[signalKey];
    if (!settings) return null;

    const params = Object.keys(settings).filter(k => !['enabled', 'category', 'pandasTaName', 'name', 'priority'].includes(k));
    const displayLabel = settings.name || signalKey.replace(/_/g, ' ').trim();

    return (
      <Card key={signalKey} className={`transition-all duration-200 ${settings.enabled ? 'ring-1 ring-primary/20 bg-primary/5' : 'opacity-80 hover:opacity-100'}`}>
        <CardContent className="p-3">
          <Collapsible>
            <div className="flex items-center justify-between">
              <label htmlFor={`switch-${signalKey}`} className="font-medium text-sm flex-1 cursor-pointer pr-2">
                {displayLabel}
              </label>
              <div className="flex items-center gap-1">
                {settings.enabled && params.length > 0 && (
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                      <SlidersHorizontal className="h-4 w-4" />
                    </Button>
                  </CollapsibleTrigger>
                )}
                <Switch
                  checked={settings.enabled}
                  onCheckedChange={(checked) => onSignalEnabledChange(signalKey, checked)}
                  id={`switch-${signalKey}`}
                />
              </div>
            </div>
            {params.length > 0 && (
              <CollapsibleContent>
                <div className="space-y-2 pt-3 mt-3 border-t border-gray-200 dark:border-gray-700">
                  {params.map(paramKey => {
                    const paramValue = settings[paramKey];
                    const isArrayParam = Array.isArray(paramValue);

                    return (
                      <div key={paramKey} className="flex items-center justify-between gap-2">
                        <Label htmlFor={`${signalKey}-${paramKey}`} className="text-xs capitalize text-muted-foreground flex-1">
                          {paramKey.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')}
                        </Label>
                        {isArrayParam ? (
                          <Input
                            id={`${signalKey}-${paramKey}`}
                            type="text"
                            value={paramValue.join(',')}
                            onChange={(e) => {
                              const stringValue = e.target.value;
                              const arrayValue = stringValue.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
                              onSignalParameterChange(signalKey, paramKey, arrayValue);
                            }}
                            className="w-full h-7 text-xs"
                            placeholder="e.g. 5,10,20,50"
                          />
                        ) : (
                          <Input
                            id={`${signalKey}-${paramKey}`}
                            type="number"
                            value={paramValue}
                            onChange={(e) => onSignalParameterChange(signalKey, paramKey, parseFloat(e.target.value) || 0)}
                            className="w-20 h-7 text-xs text-center"
                            step={paramKey.includes('period') || paramKey.includes('length') ? 1 : 0.01}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </CollapsibleContent>
            )}
          </Collapsible>
        </CardContent>
      </Card>
    );
  };

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="text-2xl flex items-center">
          <SlidersHorizontal className="mr-3 h-6 w-6" />
          Technical Signal Configuration
        </CardTitle>
        <CardDescription>
          Enable, disable, and fine-tune the parameters for each technical signal category.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Accordion type="multiple" value={openAccordions} onValueChange={onAccordionChange} className="w-full space-y-4">
          {Object.entries(SIGNAL_CATEGORIES).map(([categoryName, categoryData]) => {
            const stats = getGroupStats(categoryData.signals);
            const allEnabled = stats.enabled > 0 && stats.enabled === stats.total;
            const Icon = ICONS[categoryData.icon] || SlidersHorizontal;

            return (
              <AccordionItem value={categoryName} key={categoryName} className="border bg-gray-50 dark:bg-gray-900/40 rounded-lg">
                <div className="p-4 border-b border-gray-200 dark:border-gray-800">
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-4">
                      <Icon className="h-6 w-6 text-primary" />
                      <div>
                        <h4 className="text-lg font-semibold text-left">{categoryName}</h4>
                        <p className="text-sm text-muted-foreground text-left">{categoryData.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <Badge variant={stats.enabled > 0 ? "default" : "secondary"}>
                        {stats.enabled} / {stats.total} Enabled
                      </Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggleSignalGroup(categoryData.signals, !allEnabled)}
                      >
                        {allEnabled ? "Disable All" : "Enable All"}
                      </Button>
                    </div>
                  </div>
                </div>
                <AccordionTrigger className="p-4 hover:no-underline">
                  <div className="flex items-center justify-between w-full">
                    <span className="text-sm text-muted-foreground">Click to expand/collapse signals</span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200" />
                  </div>
                </AccordionTrigger>
                <AccordionContent className="p-4 border-t border-gray-200 dark:border-gray-800">
                  <div className="grid grid-cols-1 md::grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {categoryData.signals
                      .filter(signalKey => {
                        const settings = signalSettings[signalKey];
                        return settings && !settings.hidden; // Filter out hidden indicators
                      })
                      .map(signalKey => renderSignalControl(signalKey))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </CardContent>
    </Card>
  );
};

export default TechnicalSignalPanel;
