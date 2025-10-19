import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronsRight } from 'lucide-react';

const DataCard = ({ title, description, data, defaultOpen = false }) => (
    <Card>
        <Collapsible defaultOpen={defaultOpen}>
            <CardHeader>
                <CollapsibleTrigger className="flex justify-between items-center w-full text-left">
                    <div>
                        <CardTitle>{title}</CardTitle>
                        <CardDescription>{description}</CardDescription>
                    </div>
                    <ChevronDown className="h-5 w-5 transition-transform duration-200 group-[data-state=open]:rotate-180" />
                </CollapsibleTrigger>
            </CardHeader>
            <CollapsibleContent>
                <CardContent>
                    <pre className="bg-gray-900 text-gray-200 p-4 rounded-md overflow-x-auto text-xs">
                        {JSON.stringify(data, null, 2)}
                    </pre>
                </CardContent>
            </CollapsibleContent>
        </Collapsible>
    </Card>
);

const EvaluationTrace = ({ signalName, evaluationData }) => (
    <Card>
        <Collapsible>
            <CardHeader>
                <CollapsibleTrigger className="flex justify-between items-center w-full text-left">
                    <div>
                        <CardTitle>Signal Evaluation Trace: {signalName.toUpperCase()}</CardTitle>
                        <CardDescription>Step-by-step evaluation for the last few candles.</CardDescription>
                    </div>
                    <ChevronDown className="h-5 w-5 transition-transform duration-200 group-[data-state=open]:rotate-180" />
                </CollapsibleTrigger>
            </CardHeader>
            <CollapsibleContent>
                <CardContent className="space-y-2">
                    {evaluationData.length === 0 ? (
                         <p className="text-muted-foreground text-sm">No evaluation data collected for this signal.</p>
                    ) : (
                        evaluationData.map((trace, index) => (
                            <div key={index} className="bg-gray-50 dark:bg-gray-800 p-3 rounded-lg">
                                <p className="font-bold text-sm">Candle #{trace.candleIndex} <span className="font-normal text-xs text-muted-foreground ml-2">{trace.timestamp}</span></p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                                    <div>
                                        <h4 className="font-semibold text-xs mb-1">Inputs</h4>
                                        <pre className="bg-gray-900 text-gray-200 p-2 rounded text-xs overflow-x-auto">
                                            {JSON.stringify(trace.inputs, null, 2)}
                                        </pre>
                                    </div>
                                    <div>
                                        <h4 className="font-semibold text-xs mb-1">Output</h4>
                                        <div className="flex items-center gap-2">
                                            <ChevronsRight className="h-4 w-4 text-blue-500 flex-shrink-0" />
                                             <pre className={`p-2 rounded text-xs w-full ${trace.output.length > 0 ? 'bg-green-900/40 text-green-300' : 'bg-red-900/40 text-red-300'}`}>
                                                {trace.output.length > 0 ? JSON.stringify(trace.output, null, 2) : "No Signal Found"}
                                            </pre>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </CardContent>
            </CollapsibleContent>
        </Collapsible>
    </Card>
);

export default function DebugConsole({ data }) {
    if (!data) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Debug Console</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground">Run a backtest to populate the debug console. This tool helps diagnose issues with signal calculations and evaluations.</p>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-4">
            <DataCard title="Backtest Parameters" description="Configuration used for this backtest run." data={data.parameters} />
            <DataCard title="Raw Data Summary" description="Overview of the historical data fetched." data={data.rawDataSummary} />

            <h3 className="text-lg font-semibold mt-6">Indicator Calculation (Last 5 Candles)</h3>
            <DataCard title="OBV Calculation" description="Final calculated OBV and its SMA." data={data.indicatorCalculations.obv} defaultOpen />
            <DataCard title="MA Ribbon Calculation" description="Final calculated moving averages for the ribbon." data={data.indicatorCalculations.maRibbon} defaultOpen />
            
            <h3 className="text-lg font-semibold mt-6">Signal Evaluation Trace</h3>
            <EvaluationTrace signalName="obv" evaluationData={data.signalEvaluation.obv} />
            <EvaluationTrace signalName="maRibbon" evaluationData={data.signalEvaluation.maRibbon} />

        </div>
    );
}