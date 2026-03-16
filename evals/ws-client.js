/**
 * WebSocket client for OpenClaw gateway RPC protocol.
 * Handles connection, authentication, and agents.chat calls.
 */

import WebSocket from 'ws';
import { randomUUID } from 'crypto';

const PROTOCOL_VERSION = 23;

export class OpenClawClient {
  constructor(url, token) {
    this.url = url;
    this.token = token;
    this.ws = null;
    this.pendingRequests = new Map();
    this.connected = false;
  }

  /**
   * Connect to the OpenClaw gateway and authenticate.
   * @returns {Promise<void>}
   */
  async connect() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout (10s)'));
      }, 10000);

      this.ws = new WebSocket(this.url);

      this.ws.on('open', () => {
        // Send auth/connect frame
        const connectId = randomUUID();
        this.pendingRequests.set(connectId, {
          resolve: () => {
            clearTimeout(timeout);
            this.connected = true;
            resolve();
          },
          reject: (err) => {
            clearTimeout(timeout);
            reject(err);
          },
          chunks: [],
        });

        this.ws.send(JSON.stringify({
          type: 'req',
          id: connectId,
          method: 'connect',
          params: {
            minProtocol: PROTOCOL_VERSION,
            maxProtocol: PROTOCOL_VERSION,
            client: {
              id: 'gateway-client',
              version: '1.0.0',
              platform: 'linux',
              mode: 'backend',
            },
            auth: { token: this.token },
          },
        }));
      });

      this.ws.on('message', (data) => {
        try {
          const frame = JSON.parse(data.toString());
          this._handleFrame(frame);
        } catch (err) {
          console.error('[ws] Failed to parse frame:', err.message);
        }
      });

      this.ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`WebSocket error: ${err.message}`));
      });

      this.ws.on('close', (code, reason) => {
        this.connected = false;
        // Reject all pending requests
        for (const [id, req] of this.pendingRequests) {
          req.reject(new Error(`Connection closed: ${code} ${reason}`));
        }
        this.pendingRequests.clear();
      });
    });
  }

  /**
   * Handle incoming WebSocket frames.
   */
  _handleFrame(frame) {
    if (frame.type === 'res') {
      const pending = this.pendingRequests.get(frame.id);
      if (!pending) return;

      if (frame.ok === false || frame.error) {
        pending.reject(new Error(frame.error?.message || 'Request failed'));
        this.pendingRequests.delete(frame.id);
        return;
      }

      // For connect responses
      if (pending.isConnect !== false && !pending.isChat) {
        pending.resolve(frame.payload);
        this.pendingRequests.delete(frame.id);
        return;
      }

      // For chat responses - final response
      if (pending.isChat) {
        pending.finalPayload = frame.payload;
        // If we already have text chunks, resolve now
        pending.resolve({
          text: pending.chunks.join(''),
          payload: frame.payload,
        });
        this.pendingRequests.delete(frame.id);
      }
    }

    if (frame.type === 'event') {
      // Streaming events for agent chat
      // Find the matching pending request by looking at the runId
      for (const [id, pending] of this.pendingRequests) {
        if (pending.isChat && pending.runId === frame.payload?.runId) {
          if (frame.payload?.stream === 'text' && frame.payload?.data) {
            pending.chunks.push(typeof frame.payload.data === 'string'
              ? frame.payload.data
              : frame.payload.data?.text || '');

            // Record time-to-first-token
            if (pending.ttftRecorded === false) {
              pending.ttft = Date.now() - pending.startTime;
              pending.ttftRecorded = true;
            }
          }
          break;
        }
      }
    }
  }

  /**
   * Send a chat message to Lyra and get the full response.
   * @param {string} message - The message to send
   * @param {object} options - { timeout, sessionKey, dryRun }
   * @returns {Promise<{text: string, latencyMs: number, ttftMs: number}>}
   */
  async chat(message, options = {}) {
    if (!this.connected) {
      throw new Error('Not connected. Call connect() first.');
    }

    const { timeout = 30000, dryRun = false } = options;
    const reqId = randomUUID();
    const startTime = Date.now();

    // Prepend dry-run instruction if needed
    const finalMessage = dryRun
      ? `[EVAL MODE - DRY RUN] Describe what you WOULD do, including the exact tools and databases you would use, but do NOT execute any write operations. Show the plan without running it.\n\n${message}`
      : message;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(new Error(`Chat timeout after ${timeout}ms`));
      }, timeout);

      this.pendingRequests.set(reqId, {
        isChat: true,
        runId: null,
        chunks: [],
        startTime,
        ttft: null,
        ttftRecorded: false,
        resolve: (result) => {
          clearTimeout(timer);
          const latencyMs = Date.now() - startTime;
          resolve({
            text: result.text || '',
            latencyMs,
            ttftMs: this.pendingRequests.get(reqId)?.ttft || latencyMs,
            payload: result.payload,
          });
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      this.ws.send(JSON.stringify({
        type: 'req',
        id: reqId,
        method: 'agents.chat',
        params: {
          message: finalMessage,
          idempotencyKey: `eval-${reqId}`,
          timeout,
        },
      }));

      // Listen for the initial acceptance to get runId
      const origHandler = this._handleFrame.bind(this);
      const patchedHandler = (frame) => {
        if (frame.type === 'res' && frame.id === reqId && frame.ok && frame.payload?.runId) {
          const pending = this.pendingRequests.get(reqId);
          if (pending) {
            pending.runId = frame.payload.runId;
            // Don't resolve yet - wait for completion
            if (frame.payload.status === 'accepted') {
              return; // Wait for streaming + final
            }
          }
        }
        origHandler(frame);
      };
    });
  }

  /**
   * Disconnect from the gateway.
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }
}
