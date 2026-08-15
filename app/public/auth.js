const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4)), char => char.charCodeAt(0));
const convertRequest = options => ({ ...options, challenge: decode(options.challenge), allowCredentials: (options.allowCredentials || []).map(item => ({ ...item, id: decode(item.id) })) });
const convertCreation = options => ({ ...options, challenge: decode(options.challenge), user: { ...options.user, id: decode(options.user.id) }, excludeCredentials: (options.excludeCredentials || []).map(item => ({ ...item, id: decode(item.id) })) });

export async function registerPasskey() {
  if (!window.PublicKeyCredential) throw new Error('Passkeys are not supported in this browser');
  const start = await fetch('/v1/auth/passkey/register/options', { method: 'POST' }).then(response => response.json());
  const credential = await navigator.credentials.create({ publicKey: convertCreation(start.options) });
  const response = { id: credential.id, rawId: encode(credential.rawId), type: credential.type, response: { clientDataJSON: encode(credential.response.clientDataJSON), attestationObject: encode(credential.response.attestationObject) } };
  return fetch('/v1/auth/passkey/register/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challengeId: start.challengeId, response }) }).then(result => result.json());
}

export async function loginPasskey() {
  const start = await fetch('/v1/auth/passkey/login/options', { method: 'POST' }).then(response => response.json());
  const credential = await navigator.credentials.get({ publicKey: convertRequest(start.options) });
  const response = { id: credential.id, rawId: encode(credential.rawId), type: credential.type, response: { clientDataJSON: encode(credential.response.clientDataJSON), authenticatorData: encode(credential.response.authenticatorData), signature: encode(credential.response.signature), userHandle: credential.response.userHandle ? encode(credential.response.userHandle) : null } };
  return fetch('/v1/auth/passkey/login/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', body: JSON.stringify({ challengeId: start.challengeId, response }) }).then(result => result.json());
}
