# AI Trade Advisor Setup Guide

## Overview

The AI Trade Advisor is an intelligent chat interface that analyzes your trade performance using OpenAI's GPT models. It provides personalized insights, explains trade outcomes, and suggests improvements based on your comprehensive trade analytics.

## Features

- **Natural Language Queries**: Ask questions in plain English about your trades
- **Comprehensive Analysis**: Uses all 53+ analytics fields from your trades
- **Context-Aware**: Understands your trading history and patterns
- **Actionable Recommendations**: Provides specific, data-driven suggestions
- **Conversation History**: Maintains context across multiple questions

## Setup Instructions

### 1. Get OpenAI API Key

1. Go to [OpenAI Platform](https://platform.openai.com/api-keys)
2. Sign up or log in to your OpenAI account
3. Click "Create new secret key"
4. Copy the API key (starts with `sk-...`)

**Important**: You'll need to add credits to your OpenAI account. The system uses `gpt-4o-mini` by default for cost efficiency.

### 2. Configure Environment Variable

Add your OpenAI API key to your `.env` file:

```env
OPENAI_API_KEY=sk-your-actual-api-key-here
```

**Location**: Create or update `.env` in the project root directory.

### 3. Restart Proxy Server

After adding the API key, restart the proxy server:

```bash
# Kill existing proxy
pkill -f "node proxy-server.cjs"

# Start proxy server
cd /Users/dvirturkenitch/Downloads/newgit/crypto-sentinel-v125-backtest-comp-d9cc68b6-main
node proxy-server.cjs > proxy.log 2>&1 &
```

### 4. Access the Trade Advisor

1. Open the Analytics page in your app
2. Scroll down to the "AI Trade Advisor" section
3. The chat interface will load automatically with your trade data

## Usage Examples

### General Questions
- "What's my best performing strategy?"
- "Why am I losing money?"
- "What patterns do you see in my trades?"
- "Should I adjust my risk parameters?"

### Specific Trade Analysis
- "Why did my last trade fail?"
- "Analyze my recent losing trades"
- "What's different about my winning trades?"

### Strategy Questions
- "Which strategies work best in downtrend markets?"
- "How does volatility affect my performance?"
- "Should I change my exit strategy?"

### Performance Questions
- "What's my win rate this week?"
- "How does my performance compare to my strategies?"
- "What's my average profit per trade?"

## How It Works

### 1. Data Collection
The system automatically:
- Loads all your trades from the database
- Calculates comprehensive metrics (win rate, P&L, patterns)
- Identifies key insights and patterns
- Formats data for AI analysis

### 2. Prompt Engineering
The `TradePromptEngine` formats your trade data into structured prompts:
- **Portfolio Summary**: Overall performance metrics
- **Trade Analysis**: Detailed breakdown of individual trades
- **Pattern Identification**: Success/failure patterns
- **Context Building**: Uses all 53 analytics fields

### 3. AI Analysis
The OpenAI service:
- Sends formatted prompts to GPT-4o-mini
- Maintains conversation history for context
- Returns actionable insights and recommendations

### 4. Response Display
The chat interface:
- Shows AI responses in a conversational format
- Maintains message history
- Handles errors gracefully
- Provides loading states

## Analytics Fields Used

The system leverages all your trade analytics:

### Entry Conditions
- Market regime and confidence
- Fear & Greed Index
- Volatility metrics
- Signal strength breakdowns
- Entry quality metrics (support/resistance, momentum, volume)

### Exit Conditions
- Exit reason (SL/TP/Timeout/Manual)
- Market conditions at exit
- Exit timing vs planned
- Distance to SL/TP at exit

### Performance Metrics
- P&L (USDT and percentage)
- MFE/MAE (Maximum Favorable/Adverse Excursion)
- Time in profit/loss
- Peak profit/loss percentages
- Strategy context (win rate, occurrences)

### Lifecycle Metrics
- Trade duration
- Regime changes during trade
- Order execution details
- Slippage (when available)

## Cost Considerations

### Model Used
- **Default**: `gpt-4o-mini` (cost-efficient, fast)
- **Cost**: ~$0.15 per 1M input tokens, ~$0.60 per 1M output tokens
- **Typical Query**: ~500-1000 tokens per request

### Cost Optimization
- Conversation history limited to last 20 messages
- System prompts optimized for efficiency
- Trade summaries pre-calculated to reduce token usage

### Estimated Costs
- **Light Usage**: ~$0.01-0.05 per day (10-20 queries)
- **Moderate Usage**: ~$0.10-0.20 per day (50-100 queries)
- **Heavy Usage**: ~$0.50-1.00 per day (200+ queries)

## Troubleshooting

### "OpenAI API key not configured"
- Check your `.env` file has `OPENAI_API_KEY=...`
- Restart the proxy server after adding the key
- Verify the key starts with `sk-`

### "Failed to get AI response"
- Check your OpenAI account has credits
- Verify internet connection
- Check proxy server logs: `tail -f proxy.log | grep OpenAI`

### "No trades available"
- The advisor needs trade history to analyze
- Make some trades first, then return to Analytics page

### Slow Responses
- Normal for first query (loading trade data)
- Subsequent queries should be faster
- Check your internet connection speed

## Advanced Configuration

### Change Model
Edit `src/components/services/OpenAIService.jsx`:

```javascript
async sendMessage(message, systemContext = [], model = 'gpt-4o') {
  // Change 'gpt-4o-mini' to 'gpt-4o' for better quality (higher cost)
}
```

### Adjust Conversation History
Edit `src/components/services/OpenAIService.jsx`:

```javascript
this.maxHistoryLength = 30; // Increase from 20 for more context
```

### Customize Prompts
Edit `src/components/services/TradePromptEngine.jsx` to modify how trade data is formatted for AI analysis.

## Security Notes

- API key is stored server-side only (in `.env`)
- Never commit `.env` file to git
- API calls go through proxy server (not directly from frontend)
- All requests are logged in proxy server logs

## Support

If you encounter issues:
1. Check proxy server logs: `tail -f proxy.log`
2. Verify OpenAI API key is valid
3. Ensure proxy server is running
4. Check browser console for frontend errors

