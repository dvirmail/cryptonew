// Local development - use local API instead of Base44
import localClient from './localClient.js';

// Export local client as base44 for compatibility
export const base44 = localClient;
