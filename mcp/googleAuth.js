const vscode = require('vscode');
const crypto = require('crypto');

const TOKEN_KEY = 'google.tokens';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/contacts.readonly'
];

let loopbackPort = null;
let pendingAuth = null;

function setLoopbackPort(port) {
  loopbackPort = port;
}

function base64UrlEncode(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function createPendingAuthPromise() {
  if (pendingAuth && pendingAuth.reject) {
    pendingAuth.reject(new Error('OAuth flow superseded'));
  }
  let timeoutId;
  const promise = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => {
      pendingAuth = null;
      reject(new Error('OAuth flow timed out'));
    }, 5 * 60 * 1000);
    pendingAuth = {
      resolve: (value) => {
        clearTimeout(timeoutId);
        pendingAuth = null;
        resolve(value);
      },
      reject: (err) => {
        clearTimeout(timeoutId);
        pendingAuth = null;
        reject(err);
      }
    };
  });
  return promise;
}

function handleOAuthRedirect({ code, error, errorDescription }) {
  if (!pendingAuth) {
    return false;
  }
  if (error) {
    const err = new Error(errorDescription || error);
    pendingAuth.reject(err);
    return true;
  }
  if (!code) {
    pendingAuth.reject(new Error('OAuth flow missing authorization code'));
    return true;
  }
  pendingAuth.resolve(code);
  return true;
}

function getRedirectUri() {
  if (!loopbackPort) {
    throw new Error('Loopback server port not ready');
  }
  return `http://127.0.0.1:${loopbackPort}/oauth/google`;
}

async function readStoredTokens(context) {
  const raw = await context.secrets.get(TOKEN_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn('ai-tools: failed to parse stored google tokens', err);
    return null;
  }
}

async function storeTokens(context, tokens) {
  await context.secrets.store(TOKEN_KEY, JSON.stringify(tokens));
}

async function clearTokens(context) {
  await context.secrets.delete(TOKEN_KEY);
}

function getClientId() {
  const config = vscode.workspace.getConfiguration('aiTools.google');
  const configured = config.get('clientId');
  if (configured && typeof configured === 'string' && configured.trim()) {
    return configured.trim();
  }
  if (process.env.GOOGLE_OAUTH_CLIENT_ID) {
    return process.env.GOOGLE_OAUTH_CLIENT_ID.trim();
  }
  return null;
}

async function exchangeCodeForTokens({ clientId, code, codeVerifier, redirectUri }) {
  const params = new URLSearchParams({
    client_id: clientId,
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  const body = await res.json().catch(async () => ({ error: await res.text() }));
  if (!res.ok) {
    const err = new Error(body.error_description || body.error || 'Failed to exchange code for tokens');
    err.status = res.status;
    throw err;
  }

  return body;
}

async function refreshTokens(context, tokens, clientId) {
  if (!tokens.refresh_token) {
    throw new Error('Missing refresh token');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    refresh_token: tokens.refresh_token,
    grant_type: 'refresh_token'
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  const body = await res.json().catch(async () => ({ error: await res.text() }));
  if (!res.ok) {
    if (body.error === 'invalid_grant') {
      await clearTokens(context);
    }
    const err = new Error(body.error_description || body.error || 'Failed to refresh access token');
    err.status = res.status;
    err.code = body.error;
    throw err;
  }

  const nextTokens = {
    ...tokens,
    access_token: body.access_token,
    expires_at: Date.now() + (body.expires_in ? body.expires_in * 1000 : 3600 * 1000),
    scope: body.scope || tokens.scope,
    token_type: body.token_type || tokens.token_type
  };
  if (body.refresh_token) {
    nextTokens.refresh_token = body.refresh_token;
  }
  await storeTokens(context, nextTokens);
  return nextTokens;
}

async function performInteractiveAuth(context, { clientId, promptConsent }) {
  const codeVerifier = base64UrlEncode(crypto.randomBytes(32));
  const codeChallenge = base64UrlEncode(crypto.createHash('sha256').update(codeVerifier).digest());
  const redirectUri = getRedirectUri();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPES.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });
  if (promptConsent) {
    params.set('prompt', 'consent');
  }

  const authUrl = new URL(AUTH_ENDPOINT);
  authUrl.search = params.toString();
  const externalUri = await vscode.env.asExternalUri(vscode.Uri.parse(authUrl.toString()));
  const waitForCode = createPendingAuthPromise();
  await vscode.env.openExternal(externalUri);
  const code = await waitForCode;
  const tokenResponse = await exchangeCodeForTokens({ clientId, code, codeVerifier, redirectUri });
  const stored = {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token,
    expires_at: Date.now() + (tokenResponse.expires_in ? tokenResponse.expires_in * 1000 : 3600 * 1000),
    scope: tokenResponse.scope,
    token_type: tokenResponse.token_type
  };
  await storeTokens(context, stored);
  return stored;
}

async function ensureSession(context) {
  const clientId = getClientId();
  if (!clientId) {
    throw new Error('Set aiTools.google.clientId in settings or GOOGLE_OAUTH_CLIENT_ID env variable.');
  }

  let tokens = await readStoredTokens(context);
  if (!tokens) {
    tokens = await performInteractiveAuth(context, { clientId, promptConsent: true });
    return tokens;
  }

  if (!tokens.expires_at || Date.now() > tokens.expires_at - 60000) {
    try {
      tokens = await refreshTokens(context, tokens, clientId);
    } catch (err) {
      if (err.code === 'invalid_grant' || err.message === 'Missing refresh token') {
        tokens = await performInteractiveAuth(context, { clientId, promptConsent: true });
        return tokens;
      }
      throw err;
    }
  }

  return tokens;
}

async function getAccessToken(context) {
  const tokens = await ensureSession(context);
  return tokens.access_token;
}

async function invalidateSession(context) {
  await clearTokens(context);
}

module.exports = {
  ensureSession,
  getAccessToken,
  invalidateSession,
  setLoopbackPort,
  handleOAuthRedirect
};
