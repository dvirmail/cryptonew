/**
 * OpenAI Service
 * Handles communication with OpenAI API through the proxy server
 */
class OpenAIService {
    constructor() {
        this.proxyUrl = 'http://localhost:3003';
        this.conversationHistory = [];
        this.maxHistoryLength = 20; // Keep last 20 messages for context
    }

    /**
     * Send a message to OpenAI API
     * @param {string} message - User message
     * @param {Array} systemContext - System context data (trade analytics, etc.)
     * @param {string} model - OpenAI model to use (default: gpt-4o-mini for cost efficiency)
     * @returns {Promise<Object>} Response from OpenAI
     */
    async sendMessage(message, systemContext = [], model = 'gpt-4o-mini') {
        try {
            // Add user message to history
            this.conversationHistory.push({
                role: 'user',
                content: message
            });

            // Build messages array with system context
            const messages = [
                {
                    role: 'system',
                    content: this._buildSystemPrompt(systemContext)
                },
                ...this._getRecentHistory(),
                {
                    role: 'user',
                    content: message
                }
            ];

            const response = await fetch(`${this.proxyUrl}/api/openai/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messages,
                    model,
                    temperature: 0.7,
                    max_tokens: 1000
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'OpenAI API request failed');
            }

            const assistantMessage = data.choices?.[0]?.message?.content || 'No response generated';

            // Add assistant response to history
            this.conversationHistory.push({
                role: 'assistant',
                content: assistantMessage
            });

            // Trim history if too long
            if (this.conversationHistory.length > this.maxHistoryLength) {
                this.conversationHistory = this.conversationHistory.slice(-this.maxHistoryLength);
            }

            return {
                success: true,
                message: assistantMessage,
                usage: data.usage || null
            };
        } catch (error) {
            console.error('[OpenAIService] Error sending message:', error);
            return {
                success: false,
                error: error.message,
                message: `Error: ${error.message}`
            };
        }
    }

    /**
     * Build system prompt with trade analytics context
     * @param {Array} systemContext - Trade analytics data
     * @returns {string} System prompt
     */
    _buildSystemPrompt(systemContext) {
        const basePrompt = `You are an expert cryptocurrency trading advisor analyzing trade performance data. You provide actionable insights, identify patterns, and suggest improvements based on comprehensive trade analytics.

Your role:
- Analyze trade performance and identify success/failure patterns
- Explain why trades succeeded or failed based on analytics
- Suggest strategy improvements and risk management optimizations
- Provide clear, actionable recommendations
- Be concise but thorough in your analysis

Trade Analytics Context:
${systemContext.length > 0 ? this._formatSystemContext(systemContext) : 'No specific trade data provided. Provide general trading advice.'}

Guidelines:
- Focus on actionable insights
- Reference specific metrics when available
- Explain correlations between different factors
- Suggest concrete improvements
- Be honest about limitations in the data`;

        return basePrompt;
    }

    /**
     * Format system context data for the prompt
     * @param {Array} context - Context data array
     * @returns {string} Formatted context string
     */
    _formatSystemContext(context) {
        return context.map((item, index) => {
            if (typeof item === 'string') {
                return item;
            }
            return `[Context ${index + 1}]\n${JSON.stringify(item, null, 2)}`;
        }).join('\n\n');
    }

    /**
     * Get recent conversation history for context
     * @returns {Array} Recent messages
     */
    _getRecentHistory() {
        // Return last 10 messages (excluding current)
        const recent = this.conversationHistory.slice(-10);
        return recent.map(msg => ({
            role: msg.role,
            content: msg.content
        }));
    }

    /**
     * Clear conversation history
     */
    clearHistory() {
        this.conversationHistory = [];
    }

    /**
     * Get conversation history
     * @returns {Array} Full conversation history
     */
    getHistory() {
        return [...this.conversationHistory];
    }
}

// Export singleton instance
export const openAIService = new OpenAIService();
export default openAIService;

