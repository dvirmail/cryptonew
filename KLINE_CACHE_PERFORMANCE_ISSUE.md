# Kline Cache Performance Degradation - Root Cause Analysis

## Problem Description

The scanner's strategy evaluation stage runs fast when the app first starts, but becomes progressively slower the longer the app runs.

## Root Cause

### 1. **Proxy Server Cache (`proxy-server.cjs`)**

**Current Implementation:**
- Cache duration: **2 minutes** (`KLINE_CACHE_DURATION = 2 * 60 * 1000`)
- Cache cleanup: **Only when `klineCache.size > 1000`**
- Cleanup method: Keeps only the 500 most recent entries (by timestamp)

**Problem:**
- Expired entries (older than 2 minutes) are **NOT automatically removed**
- Expired entries accumulate in memory until cache reaches 1000 entries
- Cache lookups become slower as they check more entries (including expired ones)
- Memory usage grows unnecessarily

**Example:**
- After 1 hour of running, you might have 500 unique symbol+interval+limit combinations
- All 500 entries might be expired (older than 2 minutes)
- But cleanup only happens when cache size > 1000
- So all 500 expired entries remain, slowing down every cache lookup

### 2. **Client-Side Cache (`src/api/localClient.js`)**

**Current Implementation:**
- Cache duration: **5 seconds** (`CACHE_TTL = 5000`)
- Cache cleanup: **Only when `klineResponseCache.size > 100`**
- Cleanup method: Removes expired entries (older than 5 seconds)

**Problem:**
- Same issue as proxy server - cleanup only happens when size threshold is exceeded
- Expired entries accumulate until size > 100
- With many strategies, you can easily have 100+ unique cache keys
- Expired entries slow down cache lookups

### 3. **No Periodic Cleanup**

Neither cache has a `setInterval` or similar mechanism to periodically remove expired entries. They only clean up when:
- A new entry is added AND size threshold is exceeded
- This means if no new entries are added, expired entries never get cleaned

## Why It Gets Slower Over Time

1. **Cache Growth**: As the app runs, more unique symbol+interval+limit combinations are requested
2. **Expired Entry Accumulation**: Expired entries remain in cache (not removed automatically)
3. **Slower Lookups**: Cache lookups must check more entries, including expired ones
4. **Memory Pressure**: Unnecessary memory usage from expired entries
5. **Threshold-Based Cleanup**: Cleanup only happens when size thresholds are exceeded, not based on expiration

## Solution

Implement **proactive cleanup** of expired entries:

1. **Periodic Cleanup**: Run cleanup every 30-60 seconds to remove expired entries
2. **On-Access Cleanup**: Remove expired entries when checking cache (before returning cached value)
3. **Size-Based Cleanup**: Keep existing size-based cleanup as a fallback

This ensures expired entries are removed promptly, keeping cache size manageable and lookups fast.

