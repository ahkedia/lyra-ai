/**
 * WebSocket client for OpenClaw gateway RPC protocol v3.
 *
 * Protocol v3 (2026.3.28+): two-step challenge-response auth with device identity.
 * Chat flow: chat.send → wait for chat final event → chat.history for text.
 *
 * Uses stored device identity from /root/.openclaw/identity/ for full operator scopes.
 */

import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import { createPrivateKey, createPublicKey, sign as cryptoSign } from 'crypto';
import { readFileSync } from 'fs';

// ─── Device identity helpers ─────────────────────────────────────────────────

function base64UrlEncode(buf) {
  return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function publicKeyRawBase64Url(publicKeyPem) {
  const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
  const spki = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return base64UrlEncode(spki.subarray(SPKI_PREFIX.length));
}

function signDevicePayload(privateKeyPem, payload) {
  const key = createPrivateKey(privateKeyPem);
  return base64UrlEncode(cryptoSign(null, Buffer.from(payload, 'utf8'), key));
}

function buildDeviceAuthPayloadV3({ deviceId, clientId, clientMode, role, scopes, signedAtMs, token, nonce, platform }) {
  return [
    'v3', deviceId, clientId, clientMode, role,
    scopes.join(','), String(signedAtMs), token || '',
    nonce, (platform || '').toLowerCase(), '',
  ].join('|');
}

function loadDeviceIdentity() {
  try {
    const device = JSON.parse(readFileSync('/root/.openclaw/identity/device.json', 'utf8'));
    const auth = JSON.parse(readFileSync('/root/.openclaw/identity/device-auth.json', 'utf8'));
    const op = auth.tokens?.operator;
    if (!device.deviceId || !device.privateKeyPem || !op?.token) return null;
    return {
      deviceId: device.deviceId,
      privateKeyPem: device.privateKeyPem,
      publicKeyPem: device.publicKeyPem,
      deviceToken: op.token,
      scopes: op.scopes || ['operator.admin', 'operator.write', 'operator.read'],
    };
  } catch {
    return null;
  }
}

const DEVICE_IDENTITY = loadDeviceIdentity();

// ─── RPC helper ──────────────────────────────────────────────────────────────

function sendRpc(ws, pendingRequests, method, params) {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    pendingRequests.set(id, { resolve, reject, chunks: [] });
    ws.send(JSON.stringify({ type: 'req', id, method, params }));
  });
}

// ─── OpenClaw WebSocket Client ───────────────────────────────────────────────

export class OpenClawClient {
  constructor(url, token) {
    this.url = url;
    this.token = token;
    this.ws = null;
    this.pendingRequests = new Map();
    this.connected = false;
    this.connectNonce = null;
    this._pendingConnectId = null;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timeout (10s)')), 10000);

      this.connectNonce = null;
      this._pendingConnectId = null;
      this.ws = new WebSocket(this.url);

      this.ws.on('open', () => {
        const connectId = randomUUID();
        this._pendingConnectId = connectId;
        this.pendingRequests.set(connectId, {
          isConnect: true,
          resolve: () => { clearTimeout(timeout); this.connected = true; resolve(); },
          reject: (err) => { clearTimeout(timeout); reject(err); },
          chunks: [],
        });
      });

      this.ws.on('message', (data) => {
        try {
          this._handleFrame(JSON.parse(data.toString()));
        } catch (err) {
          console.error('[ws] Parse error:', err.message);
        }
      });

      this.ws.on('error', (err) => { clearTimeout(timeout); reject(new Error(`WebSocket error: ${err.message}`)); });

      this.ws.on('close', (code, reason) => {
        this.connected = false;
        for (const [, req] of this.pendingRequests) {
          req.reject(new Error(`Connection closed: ${code} ${reason}`));
        }
        this.pendingRequests.clear();
      });
    });
  }

  _handleFrame(frame) {
    // connect.challenge: send the connect request with device signature
    if (frame.type === 'event' && frame.event === 'connect.challenge') {
      const nonce = frame.payload?.nonce;
      if (!nonce?.trim()) {
        const p = this.pendingRequests.get(this._pendingConnectId);
        if (p) { p.reject(new Error('connect.challenge: missing nonce')); this.pendingRequests.delete(this._pendingConnectId); }
        this.ws?.close();
        return;
      }
      this.connectNonce = nonce.trim();
      this._sendConnectRequest();
      return;
    }

    // Response frames
    if (frame.type === 'res') {
      const pending = this.pendingRequests.get(frame.id);
      if (!pending) return;

      if (frame.ok === false || frame.error) {
        pending.reject(new Error(frame.error?.message || JSON.stringify(frame.error) || 'Request failed'));
        this.pendingRequests.delete(frame.id);
        return;
      }

      // connect response
      if (pending.isConnect) {
        pending.resolve();
        this.pendingRequests.delete(frame.id);
        this._pendingConnectId = null;
        return;
      }

      // generic RPC response
      pending.resolve(frame.payload);
      this.pendingRequests.delete(frame.id);
    }
  }

  _sendConnectRequest() {
    const nonce = this.connectNonce;
    const signedAtMs = Date.now();
    const role = 'operator';
    const platform = 'linux';

    let auth, device;

    if (DEVICE_IDENTITY) {
      const scopes = DEVICE_IDENTITY.scopes;
      const payload = buildDeviceAuthPayloadV3({
        deviceId: DEVICE_IDENTITY.deviceId,
        clientId: 'gateway-client',
        clientMode: 'backend',
        role, scopes, signedAtMs,
        token: DEVICE_IDENTITY.deviceToken,
        nonce, platform,
      });
      const signature = signDevicePayload(DEVICE_IDENTITY.privateKeyPem, payload);
      auth = { deviceToken: DEVICE_IDENTITY.deviceToken };
      device = {
        id: DEVICE_IDENTITY.deviceId,
        publicKey: publicKeyRawBase64Url(DEVICE_IDENTITY.publicKeyPem),
        signature,
        signedAt: signedAtMs,
        nonce,
      };
    } else {
      console.warn('[ws] No device identity — using shared token (limited scopes)');
      auth = { token: this.token };
    }

    this.ws.send(JSON.stringify({
      type: 'req',
      id: this._pendingConnectId,
      method: 'connect',
      params: {
        minProtocol: 3, maxProtocol: 3,
        client: { id: 'gateway-client', version: '1.0.0', platform, mode: 'backend' },
        caps: [], auth, role,
        scopes: DEVICE_IDENTITY?.scopes || [],
        device,
      },
    }));
  }

  /**
   * Send a chat message and wait for the response.
   *
   * Flow:
   *   1. chat.send → get runId
   *   2. Wait for chat event { runId, state:'final' }
   *   3. chat.history to get response text
   *
   * @param {string} message
   * @param {object} options - { timeout, sessionKey, dryRun }
   * @returns {Promise<{ text, latencyMs, ttftMs }>}
   */
  async chat(message, options = {}) {
    if (!this.connected) throw new Error('Not connected. Call connect() first.');

    const { timeout = 30000, sessionKey, dryRun = false } = options;

    // Each test gets an isolated session. Prefix prevents collision with other sessions.
    const evalSessionKey = sessionKey || `eval-${randomUUID()}`;
    // The gateway prefixes sessionKey with "agent:main:" for history lookups.
    const historySessionKey = `agent:main:${evalSessionKey}`;

    const startTime = Date.now();
    const idempotencyKey = `eval-${randomUUID()}`;
    let ttftMs = null;

    const finalMessage = dryRun
      ? `[EVAL MODE - DRY RUN] Describe what you WOULD do without executing write ops.\n\n${message}`
      : message;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Chat timeout after ${timeout}ms`)), timeout);

      // Step 1: send the message
      const sendId = randomUUID();
      this.pendingRequests.set(sendId, {
        resolve: async (sendPayload) => {
          const runId = sendPayload?.runId;
          if (!runId) {
            clearTimeout(timer);
            reject(new Error('chat.send: no runId in response'));
            return;
          }

          // Step 2: wait for the final event for this runId
          const onFinal = () => {
            // Step 3: get history for response text
            const histId = randomUUID();
            this.pendingRequests.set(histId, {
              resolve: (histPayload) => {
                clearTimeout(timer);
                const msgs = histPayload?.messages || [];
                const asstMsg = msgs.filter(m => m.role === 'assistant').pop();
                const text = asstMsg?.content?.find(c => c.type === 'text')?.text || '';
                const latencyMs = Date.now() - startTime;
                resolve({
                  text,
                  latencyMs,
                  ttftMs: ttftMs || latencyMs,
                  payload: asstMsg,
                });
              },
              reject: (err) => { clearTimeout(timer); reject(err); },
              chunks: [],
            });
            this.ws.send(JSON.stringify({
              type: 'req', id: histId, method: 'chat.history',
              params: { sessionKey: historySessionKey, limit: 2 },
            }));
          };

          // Register a one-time event listener for the chat final event
          const checkEvent = (data) => {
            try {
              const f = JSON.parse(data.toString());
              if (f.type === 'event' && f.event === 'agent' && 
                  f.payload?.runId === runId && f.payload?.stream === 'lifecycle') {
                if (f.payload.data?.phase === 'start' && ttftMs === null) {
                  ttftMs = Date.now() - startTime; // time to first agent activity
                }
              }
              if (f.type === 'event' && f.event === 'chat' &&
                  f.payload?.runId === runId && f.payload?.state === 'final') {
                this.ws.removeListener('message', checkEvent);
                onFinal();
              }
            } catch {}
          };
          this.ws.on('message', checkEvent);
        },
        reject: (err) => { clearTimeout(timer); reject(err); },
        chunks: [],
      });

      this.ws.send(JSON.stringify({
        type: 'req', id: sendId, method: 'chat.send',
        params: {
          sessionKey: evalSessionKey,
          idempotencyKey,
          message: finalMessage,
        },
      }));
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }
}
