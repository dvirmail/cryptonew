import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Send, Bot, User, X } from 'lucide-react';
import { openAIService } from '@/components/services/OpenAIService';
import { TradePromptEngine } from '@/components/services/TradePromptEngine';
import { useToast } from '@/components/ui/use-toast';
import { Trade } from '@/api/localClient';

const TradeAdvisorChat = ({ tradingMode = 'testnet' }) => {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [tradeData, setTradeData] = useState(null);
    const [tradeSummary, setTradeSummary] = useState(null);
    const scrollAreaRef = useRef(null);
    const inputRef = useRef(null);
    const { toast } = useToast();

    // Load trade data on mount
    useEffect(() => {
        loadTradeData();
    }, [tradingMode]);

    // Auto-scroll to bottom when new messages arrive
    useEffect(() => {
        if (scrollAreaRef.current) {
            const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
            if (scrollContainer) {
                scrollContainer.scrollTop = scrollContainer.scrollHeight;
            }
        }
    }, [messages]);

    const loadTradeData = async () => {
        try {
            setIsLoading(true);
            const trades = await Trade.filter({ trading_mode: tradingMode }, '-exit_timestamp', 1000);
            
            if (trades && trades.length > 0) {
                setTradeData(trades);
                const summary = TradePromptEngine.generateTradeSummary(trades, 'all');
                setTradeSummary(summary);

                // Add welcome message with context
                setMessages([{
                    id: 'welcome',
                    role: 'assistant',
                    content: `Hello! I'm your Trade Advisor. I've analyzed ${trades.length} trades from your ${tradingMode} account.

Key Metrics:
- Win Rate: ${summary.metrics.winRate.toFixed(1)}%
- Total P&L: $${summary.metrics.totalPnL.toFixed(2)}
- Average P&L: $${summary.metrics.avgPnL.toFixed(2)}

You can ask me questions like:
- "Why did my last trade fail?"
- "What's my best performing strategy?"
- "Should I adjust my risk parameters?"
- "Analyze my recent losing trades"
- "What patterns do you see in my trades?"

How can I help you improve your trading?`,
                    timestamp: new Date()
                }]);
            } else {
                setMessages([{
                    id: 'welcome',
                    role: 'assistant',
                    content: 'Hello! I\'m your Trade Advisor. I don\'t see any trades yet. Once you have some trade history, I can help analyze your performance and suggest improvements.',
                    timestamp: new Date()
                }]);
            }
        } catch (error) {
            console.error('[TradeAdvisor] Error loading trade data:', error);
            toast({
                title: 'Error loading trades',
                description: error.message,
                variant: 'destructive'
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;

        const userMessage = {
            id: `user-${Date.now()}`,
            role: 'user',
            content: input.trim(),
            timestamp: new Date()
        };

        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);

        try {
            // Build system context from trade data
            const systemContext = [];
            
            if (tradeSummary) {
                systemContext.push(TradePromptEngine.generatePortfolioAnalysisPrompt(tradeData, tradeSummary));
            }

            // Detect if user is asking about a specific trade
            if (input.toLowerCase().includes('last trade') || input.toLowerCase().includes('recent trade')) {
                if (tradeData && tradeData.length > 0) {
                    const lastTrade = tradeData[0]; // Most recent
                    systemContext.push(TradePromptEngine.generateTradeAnalysisPrompt(lastTrade));
                }
            }

            // Send to OpenAI
            const response = await openAIService.sendMessage(userMessage.content, systemContext);

            if (response.success) {
                const assistantMessage = {
                    id: `assistant-${Date.now()}`,
                    role: 'assistant',
                    content: response.message,
                    timestamp: new Date()
                };
                setMessages(prev => [...prev, assistantMessage]);
            } else {
                throw new Error(response.error || 'Failed to get response');
            }
        } catch (error) {
            console.error('[TradeAdvisor] Error sending message:', error);
            toast({
                title: 'Error',
                description: error.message || 'Failed to get AI response',
                variant: 'destructive'
            });
            
            const errorMessage = {
                id: `error-${Date.now()}`,
                role: 'assistant',
                content: `I'm sorry, I encountered an error: ${error.message}. Please try again or check your OpenAI API configuration.`,
                timestamp: new Date(),
                isError: true
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
            inputRef.current?.focus();
        }
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleClearChat = () => {
        openAIService.clearHistory();
        loadTradeData(); // Reload to show welcome message
    };

    return (
        <div className="w-full h-full flex flex-col">
            {/* Header with clear button */}
            <div className="flex items-center justify-end px-4 pt-2 pb-1">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearChat}
                    className="h-8 w-8 p-0"
                    title="Clear chat history"
                >
                    <X className="h-4 w-4" />
                </Button>
            </div>
            
            {/* Messages area */}
            <ScrollArea className="flex-1 px-4" ref={scrollAreaRef}>
                <div className="space-y-4 py-4">
                    {messages.map((message) => (
                        <div
                            key={message.id}
                            className={`flex gap-3 ${
                                message.role === 'user' ? 'justify-end' : 'justify-start'
                            }`}
                        >
                            {message.role === 'assistant' && (
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                                    <Bot className="h-4 w-4 text-primary" />
                                </div>
                            )}
                            <div
                                className={`max-w-[80%] rounded-lg px-4 py-2 ${
                                    message.role === 'user'
                                        ? 'bg-primary text-primary-foreground'
                                        : message.isError
                                        ? 'bg-destructive/10 text-destructive border border-destructive/20'
                                        : 'bg-muted'
                                }`}
                            >
                                <div className="text-sm whitespace-pre-wrap">{message.content}</div>
                                <div className="text-xs opacity-70 mt-1">
                                    {new Date(message.timestamp).toLocaleTimeString()}
                                </div>
                            </div>
                            {message.role === 'user' && (
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                                    <User className="h-4 w-4 text-primary" />
                                </div>
                            )}
                        </div>
                    ))}
                    {isLoading && (
                        <div className="flex gap-3 justify-start">
                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                                <Bot className="h-4 w-4 text-primary" />
                            </div>
                            <div className="bg-muted rounded-lg px-4 py-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                            </div>
                        </div>
                    )}
                </div>
            </ScrollArea>
            
            {/* Input area - fixed at bottom */}
            <div className="border-t bg-background px-4 py-3 flex-shrink-0">
                <div className="flex gap-2">
                    <Input
                        ref={inputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder="Ask about your trades, strategies, or performance..."
                        disabled={isLoading}
                        className="flex-1"
                    />
                    <Button
                        onClick={handleSend}
                        disabled={isLoading || !input.trim()}
                        size="icon"
                    >
                        {isLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Send className="h-4 w-4" />
                        )}
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default TradeAdvisorChat;

