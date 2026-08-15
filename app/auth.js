import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';

export function createPasskeyAuth({ storeDir, rpId = process.env.LYRA_RP_ID || 'localhost', origin = process.env.LYRA_ORIGIN || 'http://localhost:8787' } = {}) {
  const file = `${storeDir}/passkeys.json`;
  let state = { credentials: [], challenges: new Map() };
  if (existsSync(file)) { try { state.credentials = JSON.parse(readFileSync(file, 'utf8')).credentials || []; } catch {} }
  const persist = () => { mkdirSync(storeDir, { recursive: true }); writeFileSync(file, JSON.stringify({ credentials: state.credentials }, null, 2), { mode: 0o600 }); };
  const challenge = (kind, value) => { const id = randomUUID(); state.challenges.set(id, { kind, value, expiresAt: Date.now() + 300_000 }); return id; };
  const getChallenge = id => { const item = state.challenges.get(id); state.challenges.delete(id); if (!item || item.expiresAt < Date.now()) throw new Error('Passkey challenge expired'); return item.value; };
  return {
    hasCredentials() { return state.credentials.length > 0; },
    async registrationOptions(userId = 'akash') {
      const options = await generateRegistrationOptions({ rpName: 'Lyra', rpID: rpId, userName: userId, userDisplayName: userId, attestationType: 'none', excludeCredentials: state.credentials.map(credential => ({ id: credential.id, transports: credential.transports })) });
      return { challengeId: challenge('registration', options.challenge), options };
    },
    async verifyRegistration(challengeId, response, userId = 'akash') {
      const verification = await verifyRegistrationResponse({ response, expectedChallenge: getChallenge(challengeId), expectedOrigin: origin, expectedRPID: rpId });
      if (!verification.verified || !verification.registrationInfo) throw new Error('Passkey registration failed');
      const info = verification.registrationInfo;
      state.credentials.push({ id: info.credential.id, publicKey: Buffer.from(info.credential.publicKey).toString('base64url'), counter: info.credential.counter, userId, transports: response.response?.transports || [] }); persist();
      return { verified: true };
    },
    async authenticationOptions(userId = 'akash') {
      const options = await generateAuthenticationOptions({ rpID: rpId, allowCredentials: state.credentials.filter(item => item.userId === userId).map(item => ({ id: item.id, transports: item.transports })), userVerification: 'preferred' });
      return { challengeId: challenge('authentication', options.challenge), options };
    },
    async verifyAuthentication(challengeId, response, userId = 'akash') {
      const credential = state.credentials.find(item => item.id === response.id && item.userId === userId);
      if (!credential) throw new Error('Unknown passkey');
      const verification = await verifyAuthenticationResponse({ response, expectedChallenge: getChallenge(challengeId), expectedOrigin: origin, expectedRPID: rpId, credential: { id: credential.id, publicKey: Buffer.from(credential.publicKey, 'base64url'), counter: credential.counter, transports: credential.transports } });
      if (!verification.verified) throw new Error('Passkey authentication failed');
      credential.counter = verification.authenticationInfo.newCounter; persist(); return { verified: true, userId };
    },
    _state: state,
  };
}
