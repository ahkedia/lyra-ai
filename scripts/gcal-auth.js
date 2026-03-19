#!/usr/bin/env node

/**
 * Google Calendar OAuth2 Token Manager
 *
 * First run:  Opens auth URL, user pastes code, saves refresh token to .env
 * Subsequent: Uses refresh token to get a fresh access token
 *
 * Usage:
 *   node scripts/gcal-auth.js          # Interactive setup (first time)
 *   node scripts/gcal-auth.js --token  # Print a fresh access token (for scripts)
 *
 * As module:
 *   import { getAccessToken } from './gcal-auth.js';
 *   const token = await getAccessToken();
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import https from 'https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, '..', '.env');

const SCOPES = 'https://www.googleapis.com/auth/calendar';
const TOKEN_URL = 'oauth2.googleapis.com';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';

// --- Env helpers ---

function loadEnvVar(name) {
  // Check process.env first (set by dotenv or shell)
  if (process.env[name]) return process.env[name];

  // Fall back to reading .env file directly
  if (!existsSync(ENV_PATH)) return null;
  const lines = readFileSync(ENV_PATH, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const eqIndex = trimmed.indexOf('=');
    const key = trimmed.slice(0, eqIndex).trim();
    const val = trimmed.slice(eqIndex + 1).trim();
    if (key === name) return val;
  }
  return null;
}

function appendToEnv(key, value) {
  if (!existsSync(ENV_PATH)) {
    writeFileSync(ENV_PATH, `${key}=${value}\n`, 'utf8');
    return;
  }
  const content = readFileSync(ENV_PATH, 'utf8');
  const lines = content.split('\n');
  let found = false;
  const updated = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (found) {
    writeFileSync(ENV_PATH, updated.join('\n'), 'utf8');
  } else {
    const separator = content.endsWith('\n') ? '' : '\n';
    writeFileSync(ENV_PATH, content + separator + `${key}=${value}\n`, 'utf8');
  }
}

// --- HTTP helpers ---

function httpsPost(hostname, path, data) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(data).toString();
    const options = {
      hostname,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(responseBody) });
        } catch {
          reject(new Error(`Invalid JSON response: ${responseBody}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// --- Core functions ---

/**
 * Exchange an authorization code for tokens.
 */
async function exchangeCode(code, clientId, clientSecret) {
  const result = await httpsPost(TOKEN_URL, '/token', {
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  });

  if (result.status !== 200 || !result.data.refresh_token) {
    throw new Error(`Token exchange failed: ${JSON.stringify(result.data)}`);
  }
  return result.data;
}

/**
 * Refresh an access token using a refresh token.
 */
async function refreshAccessToken(refreshToken, clientId, clientSecret) {
  const result = await httpsPost(TOKEN_URL, '/token', {
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  });

  if (result.status !== 200 || !result.data.access_token) {
    throw new Error(`Token refresh failed: ${JSON.stringify(result.data)}`);
  }
  return result.data.access_token;
}

/**
 * Get a fresh access token. Uses refresh token from env.
 * This is the main export for other scripts.
 */
export async function getAccessToken() {
  const clientId = loadEnvVar('GOOGLE_CLIENT_ID');
  const clientSecret = loadEnvVar('GOOGLE_CLIENT_SECRET');
  const refreshToken = loadEnvVar('GOOGLE_REFRESH_TOKEN');

  if (!clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env');
  }
  if (!refreshToken) {
    throw new Error('Missing GOOGLE_REFRESH_TOKEN. Run: node scripts/gcal-auth.js');
  }

  return refreshAccessToken(refreshToken, clientId, clientSecret);
}

// --- Interactive setup ---

async function interactiveSetup() {
  const clientId = loadEnvVar('GOOGLE_CLIENT_ID');
  const clientSecret = loadEnvVar('GOOGLE_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    console.error('Error: Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.');
    console.error('See: skills/google-calendar/SKILL.md for setup instructions.');
    process.exit(1);
  }

  const existingToken = loadEnvVar('GOOGLE_REFRESH_TOKEN');
  if (existingToken) {
    console.log('GOOGLE_REFRESH_TOKEN already exists in .env.');
    const answer = await prompt('Overwrite? (y/N): ');
    if (answer.toLowerCase() !== 'y') {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  const authUrl = `${AUTH_URL}?client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(SCOPES)}&access_type=offline&prompt=consent`;

  console.log('\n1. Open this URL in your browser:\n');
  console.log(authUrl);
  console.log('\n2. Authorize the app, then paste the code below:\n');

  const code = await prompt('Authorization code: ');
  if (!code) {
    console.error('No code provided. Aborted.');
    process.exit(1);
  }

  const tokens = await exchangeCode(code, clientId, clientSecret);
  appendToEnv('GOOGLE_REFRESH_TOKEN', tokens.refresh_token);

  console.log('\nSaved GOOGLE_REFRESH_TOKEN to .env');
  console.log(`Access token (valid ~1 hour): ${tokens.access_token.slice(0, 20)}...`);
  console.log('\nSetup complete. You can now use gcal-helper.js.');
}

// --- CLI entry ---

const args = process.argv.slice(2);

if (args.includes('--token')) {
  // Print fresh access token and exit
  try {
    const token = await getAccessToken();
    console.log(token);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
} else if (args.length === 0 || args.includes('--setup')) {
  await interactiveSetup();
}
