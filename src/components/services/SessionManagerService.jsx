
import { scannerSessionManager } from '@/api/functions';
import { queueFunctionCall } from '@/components/utils/apiQueue';

export default class SessionManagerService {
  constructor(scannerService) {
    this.scannerService = scannerService;
    this.addLog = scannerService.addLog.bind(scannerService);
    this.notifySubscribers = scannerService.notifySubscribers.bind(scannerService);

    // CRITICAL: Initialize sessionId at construction time for stability
    this.sessionId = this._initializeSessionId();
    if (!this.sessionId) {
      throw new Error('[SESSION] CRITICAL: Failed to initialize sessionId');
    }

    this.monitoringInterval = null;
    this.isMonitoring = false; // New flag for monitoring state

    // Bind methods to preserve context
    this.handleBeforeUnload = this.handleBeforeUnload.bind(this);
    this.handlePageHide = this.handlePageHide.bind(this);

    // Register unload handlers immediately
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.handleBeforeUnload);
      window.addEventListener('pagehide', this.handlePageHide);
    }

    this.addLog(`[SESSION] SessionManagerService initialized with ID: ${this.sessionId}`, 'system');
  }

  _initializeSessionId() {
    try {
      const key = 'scanner_session_id';
      let sid = sessionStorage.getItem(key);
      if (!sid) {
        // Generate new session ID
        const timestamp = Date.now();
        const random = Math.floor(1000 + Math.random() * 9000);
        const counter = Math.floor(10000 + Math.random() * 90000);
        sid = `session_${timestamp}-${random}-${counter}`;
        sessionStorage.setItem(key, sid);
        //console.log(`[SESSION] Generated new sessionId: ${sid}`);
      } else {
        //console.log(`[SESSION] Retrieved existing sessionId: ${sid}`);
      }
      return sid;
    } catch (e) {
      throw new Error('Session storage not available');
    }
  }

  _validateSessionId() {
    if (!this.sessionId) {
      const error = new Error('[SESSION] CRITICAL: sessionId is missing');
      this.addLog(error.message, 'error');
      throw error;
    }
  }

  handleBeforeUnload(event) {
    this._reliableReleaseSession();
  }

  handlePageHide(event) {
    this._reliableReleaseSession();
  }

  _reliableReleaseSession() {
    // Use modern APIs for reliable session release during page dismissal
    // navigator.sendBeacon is specifically designed for this use case
    try {
      this._validateSessionId();
      
      const payload = JSON.stringify({
          action: 'releaseSession',
          sessionId: this.sessionId
      });
      
      //console.log(`[SESSION] Attempting reliable session release for: ${this.sessionId}`);
      
      const functionUrl = '/api/functions/scannerSessionManager';
      
      // Try sendBeacon first (preferred method for page dismissal)
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) { // Check if navigator and sendBeacon exist
          // Create a Blob with proper content type for JSON
          const blob = new Blob([payload], { type: 'application/json' });
          const sent = navigator.sendBeacon(functionUrl, blob);
          
          if (sent) {
              return;
          } else {
              console.warn('[SESSION] sendBeacon failed, trying keepalive fetch');
          }
      }
      
      // Fallback: fetch with keepalive (allows request to complete after page unload)
      // Ensure fetch is available (e.g., in browser environment)
      if (typeof fetch !== 'undefined') {
        fetch(functionUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true // Critical: allows request to outlive the page
        }).then(() => {
            // Session release successful
        }).catch((error) => {
            console.warn('[SESSION] Session release via keepalive fetch failed:', error);
        });
      } else {
        console.warn('[SESSION] Neither sendBeacon nor fetch are available for reliable session release.');
      }
      
    } catch (e) {
        console.error('[SESSION] Error during reliable session release:', e);
    }
  }

  async start(force = false) {
    console.log('[SESSION] 🔍 start() called with force:', force);
    this._validateSessionId();

    // Prevent rapid successive start calls
    if (this._isStarting) {
      console.log('[SESSION] 🔍 Already starting, returning false');
      return false;
    }
    
    this._isStarting = true;
    console.log('[SESSION] 🔍 Setting _isStarting to true');

    this.addLog(`[SESSION] Attempting to claim leadership${force ? ' (FORCE MODE)' : ''}...`, 'system');

    try {
      const maxRetries = force ? 1 : 3;
      let attempt = 0;
      let lastError = null;

      while (attempt < maxRetries) {
        attempt++;

        try {
          //console.log(`[SESSION] Claim attempt ${attempt}/${maxRetries}`, { sessionId: this.sessionId, force });

          const response = await scannerSessionManager({
            action: 'claimSession',
            sessionId: this.sessionId,
            force: force
          });

          //console.log('[SESSION] claimSession response:', response.data);

          if (response?.data?.success) {
            console.log('[SESSION] ✅ Session claim successful, starting running state...');
            this.scannerService.state.leaderSessionId = this.sessionId;
            await this.scannerService._startRunningState();
            console.log('[SessionManagerService] 📊 DEBUG: _startRunningState completed');
            this.addLog('[SESSION] ✅ Leadership claimed successfully', 'success');
            this._isStarting = false;
            return true;
          } else {
            const errorMsg = response?.data?.error || 'Unknown error';
            const code = response?.data?.code;
            const currentLeader = response?.data?.currentLeader;

            console.log('[SESSION] ❌ Session claim failed:', { errorMsg, code, currentLeader, sessionId: this.sessionId });
            lastError = new Error(errorMsg);

            // If session already claimed by another active (non-stale) leader, don't retry
            if (code === 'already_claimed' && !force) {
              console.log('[SESSION] ⚠️ Session already claimed by:', currentLeader);
              this.addLog(`[SESSION] ⚠️ Another tab is already leading. Use "Take Control" to override.`, 'warning');
              // Also update the state based on the current leader
              const statusResponse = await scannerSessionManager({ action: 'getSessionStatus' });
              if (statusResponse?.data) {
                this.scannerService.state.leaderSessionId = statusResponse.data.active_session_id || null;
                this.scannerService.state.isGloballyActive = Boolean(statusResponse.data.is_active);
                this.notifySubscribers();
              }
              return false;
            }

            // If stale, wait a bit and retry
            if (attempt < maxRetries) {
              const delay = 500 * attempt; // Exponential backoff: 500ms, 1000ms, 1500ms
              this.addLog(`[SESSION] Claim failed (${errorMsg}), retrying in ${delay}ms... (${attempt}/${maxRetries})`, 'warning');
              await new Promise(resolve => setTimeout(resolve, delay));

              // Check status before retrying
              const statusResponse = await scannerSessionManager({ action: 'getSessionStatus' });

              // If session became available, continue with retry
              if (!statusResponse?.data?.is_active || statusResponse?.data?.active_session_id === this.sessionId) {
                continue;
              } else {
                // If still active by another session, and we're not forcing, stop retrying
                this.addLog(`[SESSION] ⚠️ Another tab claimed leadership during retry. Stopping claim attempts.`, 'warning');
                lastError = new Error('Another session became active');
                break; // Exit retry loop
              }
            }
          }
        } catch (err) {
          lastError = err;
          console.error(`[SESSION] Error during claim attempt ${attempt}:`, err);

          if (attempt < maxRetries) {
            const delay = 500 * attempt;
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      // All retries exhausted
      const errorMessage = lastError?.message || 'Unknown error';
      this.addLog(`[SESSION] ❌ Failed to claim leadership after ${maxRetries} attempts: ${errorMessage}`, 'error');
      console.error('[SESSION] Error during start():', errorMessage);
      this._isStarting = false;
      return false;

    } catch (error) {
      this.addLog(`[SESSION] ❌ Critical error during start(): ${error.message}`, 'error');
      console.error('[SESSION] Critical error during start():', error);
      this._isStarting = false;
      return false;
    } finally {
      this.notifySubscribers(); // Ensure subscribers are notified of final state
    }
  }

  async stop() {
    this._validateSessionId();

    // Prevent rapid successive stop calls
    if (this._isStopping) {
      return false;
    }
    
    this._isStopping = true;

    this.addLog('[SESSION] Releasing leadership...', 'system');

    try {
      // Async release (primary method)
      const response = await scannerSessionManager({
        action: 'releaseSession',
        sessionId: this.sessionId
      });


      if (response?.data?.success) {
        this.scannerService._stopRunningState();
        this.addLog('[SESSION] ✅ Leadership released successfully', 'success');
        this.scannerService.state.leaderSessionId = null; // Clear local leader state
        this._isStopping = false;
        return true;
      } else {
        this.addLog(`[SESSION] ⚠️ Release reported non-success: ${response?.data?.error || 'Unknown'}`, 'warning');
        // Still stop running state locally even if release failed on backend
        this.scannerService._stopRunningState();
        this._isStopping = false;
        return false;
      }
    } catch (error) {
      this.addLog(`[SESSION] ❌ Error during stop(): ${error.message}`, 'error');
      console.error('[SESSION] Error during stop():', error);
      // Still stop running state locally
      this.scannerService._stopRunningState();
      this._isStopping = false;
      return false;
    } finally {
      this.notifySubscribers();
    }
  }

  async forceStop() {
    this._validateSessionId();

    this.addLog('[SESSION] Force stopping and releasing leadership...', 'system');

    // First stop local state immediately
    this.scannerService._stopRunningState();
    this.scannerService.state.leaderSessionId = null; // Clear local leader state immediately
    this.notifySubscribers(); // Notify subscribers of local state change

    // Then try to release session
    try {
      await scannerSessionManager({
        action: 'releaseSession',
        sessionId: this.sessionId
      });
      this.addLog('[SESSION] ✅ Force stop completed', 'success');
    } catch (error) {
      this.addLog(`[SESSION] ⚠️ Force stop completed (release error: ${error.message})`, 'warning');
    }

    return true;
  }

  async claimLeadership() { // This method is now intended for heartbeat/re-claiming logic
    this._validateSessionId();

    //console.log('[SESSION] claimLeadership() heartbeat', { sessionId: this.sessionId });

    try {
      const response = await scannerSessionManager({
        action: 'claimSession',
        sessionId: this.sessionId,
        force: false // This claim is not a "force" takeover
      });

      if (response?.data?.success) {
        this.scannerService.state.leaderSessionId = this.sessionId;
        return true;
      }
      return false;
    } catch (error) {
      console.error('[SESSION] Error during claimLeadership() heartbeat:', error);
      return false;
    } finally {
      this.notifySubscribers();
    }
  }

  async verifyLeadership() {
    this._validateSessionId();

    try {
      const response = await scannerSessionManager({ action: 'getSessionStatus' });

      if (!response?.data) {
        console.warn('[SESSION] verifyLeadership: No data received from getSessionStatus');
        return false;
      }

      const { is_active, active_session_id } = response.data;
      const isLeader = is_active && active_session_id === this.sessionId;

      this.scannerService.state.leaderSessionId = active_session_id || null;
      this.scannerService.state.isGloballyActive = Boolean(is_active);

      if (!isLeader && this.scannerService.state.leaderSessionId === this.sessionId) {
        // If local state says we are leader but backend says no, adjust local state
        this.addLog('[SESSION] ⚠️ Leadership lost - another tab became active or session expired.', 'warning');
        this.scannerService._stopRunningState(); // Ensure local running state is stopped
      }
      return isLeader;
    } catch (error) {
      console.error('[SESSION] Error verifying leadership:', error);
      // On error, assume no leadership or active session globally
      this.scannerService.state.leaderSessionId = null;
      this.scannerService.state.isGloballyActive = false;
      return false;
    } finally {
      this.notifySubscribers();
    }
  }

  async attemptSessionRecovery() {
    this._validateSessionId();
    
    this.addLog('[SESSION] 🔄 Attempting session recovery after system wake-up...', 'system');
    
    const maxRetries = 5;
    let attempt = 0;
    
    while (attempt < maxRetries) {
      try {
        attempt++;
        this.addLog(`[SESSION] 🔄 Recovery attempt ${attempt}/${maxRetries}...`, 'system');
        
        // First, try to verify current leadership
        const hasLeadership = await this.verifyLeadership();
        
        if (hasLeadership) {
          this.addLog('[SESSION] ✅ Session recovery successful - leadership maintained', 'success');
          return true;
        }
        
        // If no leadership, try to start a new session
        this.addLog('[SESSION] 🔄 No active leadership - attempting to start new session...', 'system');
        const startResult = await this.start();
        
        if (startResult) {
          this.addLog('[SESSION] ✅ Session recovery successful - new session started', 'success');
          return true;
        } else {
          this.addLog(`[SESSION] ⚠️ Recovery attempt ${attempt} failed - retrying...`, 'warning');
          
          if (attempt < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt), 10000); // Exponential backoff, max 10s
            this.addLog(`[SESSION] ⏳ Waiting ${delay}ms before retry...`, 'system');
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      } catch (error) {
        this.addLog(`[SESSION] ❌ Recovery attempt ${attempt} error: ${error.message}`, 'error');
        console.error('[SESSION] Session recovery error:', error);
        
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          this.addLog(`[SESSION] ⏳ Waiting ${delay}ms before retry...`, 'system');
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    this.addLog('[SESSION] ❌ Session recovery failed after all retries', 'error');
    return false;
  }

  startMonitoring() {
    if (this.isMonitoring) {
      return;
    }

    this.isMonitoring = true;
    this.addLog('[SESSION] Starting passive monitoring (60s interval)', 'system');

    this.monitoringInterval = setInterval(async () => {
      try {
        await this.verifyLeadership();
      } catch (error) {
        console.error('[SESSION] Error during monitoring:', error);
        // Don't stop monitoring on errors - continue trying to maintain session
        this.addLog('[SESSION] Monitoring error - continuing to maintain session', 'warning');
      }
    }, 60000); // 60 seconds

    // Add additional keep-alive mechanism for extended offline periods
    this.keepAliveInterval = setInterval(async () => {
      try {
        if (this.scannerService.state.isRunning) {
          // Send keep-alive signal even if not visible
          await this.verifyLeadership();
          this.addLog('[SESSION] Keep-alive signal sent', 'debug');
        }
      } catch (error) {
        console.error('[SESSION] Keep-alive error:', error);
        // If keep-alive fails, attempt session recovery
        this.addLog('[SESSION] Keep-alive failed - attempting session recovery', 'warning');
        await this.attemptSessionRecovery();
      }
    }, 300000); // 5 minutes - more frequent keep-alive

    // Add emergency recovery mechanism for extended offline periods
    this.emergencyRecoveryInterval = setInterval(async () => {
      try {
        if (this.scannerService.state.isRunning) {
          // Check if we've been offline for too long
          const lastHeartbeat = this.scannerService.state.lastHeartbeat || 0;
          const timeSinceLastHeartbeat = Date.now() - lastHeartbeat;
          
          if (timeSinceLastHeartbeat > 600000) { // 10 minutes without heartbeat
            this.addLog('[SESSION] Emergency recovery triggered - no heartbeat for 10+ minutes', 'warning');
            await this.attemptSessionRecovery();
          }
        }
      } catch (error) {
        console.error('[SESSION] Emergency recovery error:', error);
      }
    }, 600000); // Check every 10 minutes
  }

  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    if (this.emergencyRecoveryInterval) {
      clearInterval(this.emergencyRecoveryInterval);
      this.emergencyRecoveryInterval = null;
    }
    this.isMonitoring = false;
    this.addLog('[SESSION] Stopped passive monitoring', 'system');
  }

  destroy() {
    this.stopMonitoring();

    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.handleBeforeUnload);
      window.removeEventListener('pagehide', this.handlePageHide);
    }

    this.addLog('[SESSION] SessionManagerService destroyed', 'system');
  }
}
