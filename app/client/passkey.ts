const encode = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4)), char => char.charCodeAt(0));
async function jsonOrThrow(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Passkey request failed');
  return payload;
}

export async function registerPasskey() {
  if (!window.PublicKeyCredential) throw new Error('Face ID is not supported in this browser');
  const start = await fetch('/v1/auth/passkey/register/options', { method: 'POST', credentials: 'include' }).then(jsonOrThrow);
  const publicKey = { ...start.options, challenge: decode(start.options.challenge), user: { ...start.options.user, id: decode(start.options.user.id) }, excludeCredentials: (start.options.excludeCredentials || []).map((item: any) => ({ ...item, id: decode(item.id) })) } as PublicKeyCredentialCreationOptions;
  const credential = await navigator.credentials.create({ publicKey }) as PublicKeyCredential;
  return fetch('/v1/auth/passkey/register/verify', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challengeId: start.challengeId, response: { id: credential.id, rawId: encode(credential.rawId), type: credential.type, response: { clientDataJSON: encode((credential.response as AuthenticatorAttestationResponse).clientDataJSON), attestationObject: encode((credential.response as AuthenticatorAttestationResponse).attestationObject) } } }) }).then(jsonOrThrow);
}

export async function loginPasskey() {
  const start = await fetch('/v1/auth/passkey/login/options', { method: 'POST', credentials: 'include' }).then(jsonOrThrow);
  const publicKey = { ...start.options, challenge: decode(start.options.challenge), allowCredentials: (start.options.allowCredentials || []).map((item: any) => ({ ...item, id: decode(item.id) })) } as PublicKeyCredentialRequestOptions;
  const credential = await navigator.credentials.get({ publicKey }) as PublicKeyCredential;
  const response = credential.response as AuthenticatorAssertionResponse;
  return fetch('/v1/auth/passkey/login/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', body: JSON.stringify({ challengeId: start.challengeId, response: { id: credential.id, rawId: encode(credential.rawId), type: credential.type, response: { clientDataJSON: encode(response.clientDataJSON), authenticatorData: encode(response.authenticatorData), signature: encode(response.signature), userHandle: response.userHandle ? encode(response.userHandle) : null } } }) }).then(jsonOrThrow);
}
