import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { fixture } from './helpers.mjs';
import {
  provisionOwnerOidc,
  OWNER_SESSION_SECONDS,
  OWNER_OIDC_CLIENT,
  OWNER_OIDC_SOURCE
} from '../server/owner-oidc.mjs';

function parseJwt(token) {
  const [h, p, s] = token.split('.');
  return {
    header: JSON.parse(Buffer.from(h, 'base64url').toString()),
    payload: JSON.parse(Buffer.from(p, 'base64url').toString()),
    signature: Buffer.from(s, 'base64url'),
    signingInput: Buffer.from(h + '.' + p)
  };
}

test('Owner OIDC: metadata discovery and JWKS public key endpoint', async t => {
  const x = await fixture(t);

  // 1. Before provisioning, discovery returns 503
  const before = await x.call('/oidc/owner/.well-known/openid-configuration');
  assert.equal(before.status, 503);
  assert.match(before.data.error, /chưa bootstrap/i);

  // 2. Provision OIDC IdP
  const creds = provisionOwnerOidc(x.hub.store, x.origin);
  assert.equal(creds.client_id, OWNER_OIDC_CLIENT);
  assert.ok(creds.client_secret);
  assert.equal(creds.discovery_url, x.origin + '/oidc/owner/.well-known/openid-configuration');

  // 3. Discovery endpoint returns 200 with OIDC configuration
  const meta = await x.call('/oidc/owner/.well-known/openid-configuration');
  assert.equal(meta.status, 200);
  assert.equal(meta.data.issuer, x.origin + '/oidc/owner');
  assert.equal(meta.data.authorization_endpoint, x.origin + '/oidc/owner/authorize');
  assert.equal(meta.data.token_endpoint, x.origin + '/oidc/owner/token');
  assert.equal(meta.data.userinfo_endpoint, x.origin + '/oidc/owner/userinfo');
  assert.equal(meta.data.jwks_uri, x.origin + '/oidc/owner/jwks');
  assert.equal(meta.data.end_session_endpoint, x.origin + '/oidc/owner/logout');
  assert.deepEqual(meta.data.response_types_supported, ['code']);
  assert.deepEqual(meta.data.id_token_signing_alg_values_supported, ['RS256']);
  assert.deepEqual(meta.data.grant_types_supported, ['authorization_code']);
  assert.deepEqual(meta.data.scopes_supported, ['openid', 'profile', 'email', 'groups']);

  // 4. JWKS endpoint returns valid RS256 public key
  const jwks = await x.call('/oidc/owner/jwks');
  assert.equal(jwks.status, 200);
  assert.equal(jwks.data.keys.length, 1);
  const key = jwks.data.keys[0];
  assert.equal(key.kty, 'RSA');
  assert.equal(key.alg, 'RS256');
  assert.equal(key.use, 'sig');
  assert.ok(key.kid);
  assert.ok(key.n);
  assert.ok(key.e);

  // Verify key can be imported as an RSA public key
  const pubKey = createPublicKey({ key, format: 'jwk' });
  assert.equal(pubKey.asymmetricKeyType, 'rsa');
});

test("Owner OIDC: Hub session stays short-lived (12h), independent from Gitea's 30-day session", async t => {
  // OWNER_SESSION_SECONDS describes Gitea's own session length (see docs/GITEA_OPERATIONS.md
  // and scripts/gitea.py's SESSION_LIFE_TIME) — it must never widen Hub's own owner login.
  assert.equal(OWNER_SESSION_SECONDS, 30 * 24 * 60 * 60);

  const x = await fixture(t);
  const loginRes = await x.call('/api/login', 'POST', {
    username: 'owner',
    password: 'owner-password-123'
  });
  assert.equal(loginRes.status, 200);

  const setCookie = loginRes.headers.get('set-cookie');
  assert.ok(setCookie.includes('Max-Age=43200'), 'Hub cookie Max-Age must stay 43200s (12h)');

  const sessions = x.hub.store.list('session');
  assert.ok(sessions.length > 0);
  const s = sessions[sessions.length - 1];
  const ttlSeconds = Math.round((s.expires - s.created) / 1000);
  assert.equal(ttlSeconds, 12 * 3600);
});

test('Owner OIDC: authorization flow when logged in vs not logged in, and resumption', async t => {
  const x = await fixture(t);
  provisionOwnerOidc(x.hub.store, x.origin);

  const callback = x.origin + '/gitea/user/oauth2/' + OWNER_OIDC_SOURCE + '/callback';

  // 1. Logged in: direct 302 redirect to Gitea callback with code and state
  const authParams = new URLSearchParams({
    client_id: OWNER_OIDC_CLIENT,
    redirect_uri: callback,
    response_type: 'code',
    scope: 'openid profile email groups',
    state: 'state-random-123',
    nonce: 'nonce-random-456'
  });

  const authedRes = await x.call('/oidc/owner/authorize?' + authParams.toString());
  assert.equal(authedRes.status, 302);
  const authedLoc = new URL(authedRes.headers.get('location'));
  assert.equal(authedLoc.origin + authedLoc.pathname, callback);
  assert.equal(authedLoc.searchParams.get('state'), 'state-random-123');
  assert.ok(authedLoc.searchParams.get('code'));

  // 2. Not logged in: redirects to /#gitea/<flowId>
  const unauthedRes = await x.call(
    '/oidc/owner/authorize?' + authParams.toString(),
    'GET',
    undefined,
    { Cookie: '' }
  );
  assert.equal(unauthedRes.status, 302);
  const unauthedLoc = unauthedRes.headers.get('location');
  assert.match(unauthedLoc, /^\/#gitea\/[\w-]+$/);
  const flowId = unauthedLoc.slice('/#gitea/'.length);

  // 3. Resume flow after authenticating
  const resumeRes = await x.call('/oidc/owner/resume?flow=' + flowId);
  assert.equal(resumeRes.status, 302);
  const resumeLoc = new URL(resumeRes.headers.get('location'));
  assert.equal(resumeLoc.origin + resumeLoc.pathname, callback);
  assert.equal(resumeLoc.searchParams.get('state'), 'state-random-123');
  assert.ok(resumeLoc.searchParams.get('code'));

  // 4. Flow is single use: resuming again fails
  const reResume = await x.call('/oidc/owner/resume?flow=' + flowId);
  assert.equal(reResume.status, 400);

  // 5. prompt=none when unauthenticated returns login_required error to callback
  const promptNoneRes = await x.call(
    '/oidc/owner/authorize?' + authParams.toString() + '&prompt=none',
    'GET',
    undefined,
    { Cookie: '' }
  );
  assert.equal(promptNoneRes.status, 302);
  const promptNoneLoc = new URL(promptNoneRes.headers.get('location'));
  assert.equal(promptNoneLoc.searchParams.get('error'), 'login_required');
});

test('Owner OIDC: parameter validation on authorize', async t => {
  const x = await fixture(t);
  provisionOwnerOidc(x.hub.store, x.origin);
  const callback = x.origin + '/gitea/user/oauth2/' + OWNER_OIDC_SOURCE + '/callback';

  // Wrong client_id -> 400
  const badClient = await x.call(
    '/oidc/owner/authorize?' +
      new URLSearchParams({
        client_id: 'wrong-client',
        redirect_uri: callback,
        response_type: 'code',
        scope: 'openid'
      })
  );
  assert.equal(badClient.status, 400);

  // Wrong redirect_uri -> 400
  const badRedirect = await x.call(
    '/oidc/owner/authorize?' +
      new URLSearchParams({
        client_id: OWNER_OIDC_CLIENT,
        redirect_uri: 'https://attacker.example/callback',
        response_type: 'code',
        scope: 'openid'
      })
  );
  assert.equal(badRedirect.status, 400);

  // Missing openid scope -> 400
  const missingOpenid = await x.call(
    '/oidc/owner/authorize?' +
      new URLSearchParams({
        client_id: OWNER_OIDC_CLIENT,
        redirect_uri: callback,
        response_type: 'code',
        scope: 'profile email'
      })
  );
  assert.equal(missingOpenid.status, 400);

  // Disallowed scope -> 400
  const badScope = await x.call(
    '/oidc/owner/authorize?' +
      new URLSearchParams({
        client_id: OWNER_OIDC_CLIENT,
        redirect_uri: callback,
        response_type: 'code',
        scope: 'openid admin_all'
      })
  );
  assert.equal(badScope.status, 400);

  // Parameter pollution (duplicate keys) -> 400
  const polluted = await x.call(
    '/oidc/owner/authorize?client_id=' +
      OWNER_OIDC_CLIENT +
      '&client_id=evil&redirect_uri=' +
      encodeURIComponent(callback) +
      '&response_type=code&scope=openid'
  );
  assert.equal(polluted.status, 400);
});

test('Owner OIDC: token exchange, RS256 ID Token verification, userinfo, and single-use code', async t => {
  const x = await fixture(t);
  const creds = provisionOwnerOidc(x.hub.store, x.origin);
  const callback = x.origin + '/gitea/user/oauth2/' + OWNER_OIDC_SOURCE + '/callback';

  // Obtain code
  const authRes = await x.call(
    '/oidc/owner/authorize?' +
      new URLSearchParams({
        client_id: OWNER_OIDC_CLIENT,
        redirect_uri: callback,
        response_type: 'code',
        scope: 'openid profile email groups',
        state: 'test-state-789',
        nonce: 'test-nonce-101'
      })
  );
  const code = new URL(authRes.headers.get('location')).searchParams.get('code');
  assert.ok(code);

  // Exchange via HTTP Basic Auth (client_secret_basic)
  const basicAuth =
    'Basic ' + Buffer.from(OWNER_OIDC_CLIENT + ':' + creds.client_secret).toString('base64');
  const tokenRes = await fetch(x.origin + '/oidc/owner/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuth
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callback
    }).toString()
  });
  assert.equal(tokenRes.status, 200);
  const tokens = await tokenRes.json();
  assert.ok(tokens.access_token);
  assert.equal(tokens.token_type, 'Bearer');
  assert.ok(tokens.expires_in > 0);
  assert.ok(tokens.id_token);

  // Verify ID Token JWT
  const jwt = parseJwt(tokens.id_token);
  assert.equal(jwt.header.alg, 'RS256');
  assert.equal(jwt.header.typ, 'JWT');
  assert.ok(jwt.header.kid);

  // Verify claims
  assert.equal(jwt.payload.iss, x.origin + '/oidc/owner');
  assert.equal(jwt.payload.aud, OWNER_OIDC_CLIENT);
  assert.ok(jwt.payload.sub.startsWith('owner-'));
  assert.equal(jwt.payload.preferred_username, 'genhub-owner');
  assert.equal(jwt.payload.name, 'owner');
  assert.equal(jwt.payload.email, jwt.payload.sub + '@sso.localhost.invalid');
  assert.equal(jwt.payload.email_verified, true);
  assert.deepEqual(jwt.payload.groups, ['genhub-owner']);
  assert.equal(jwt.payload.nonce, 'test-nonce-101');
  assert.ok(jwt.payload.iat <= Math.floor(Date.now() / 1000));
  assert.ok(jwt.payload.exp > jwt.payload.iat);
  assert.ok(jwt.payload.auth_time > 0);

  // Verify at_hash
  const expectedAtHash = createHash('sha256')
    .update(tokens.access_token)
    .digest()
    .subarray(0, 16)
    .toString('base64url');
  assert.equal(jwt.payload.at_hash, expectedAtHash);

  // Verify signature with public key from JWKS
  const jwksRes = await x.call('/oidc/owner/jwks');
  const jwk = jwksRes.data.keys.find(k => k.kid === jwt.header.kid);
  assert.ok(jwk);
  const pubKey = createPublicKey({ key: jwk, format: 'jwk' });
  const validSig = verify('RSA-SHA256', jwt.signingInput, pubKey, jwt.signature);
  assert.equal(validSig, true, 'ID Token signature must verify with JWKS public key');

  // Single-use code: exchanging again fails with 400 invalid_grant
  const reuseRes = await fetch(x.origin + '/oidc/owner/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuth
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callback
    }).toString()
  });
  assert.equal(reuseRes.status, 400);

  // Userinfo endpoint with access_token
  const userinfoRes = await fetch(x.origin + '/oidc/owner/userinfo', {
    headers: { Authorization: 'Bearer ' + tokens.access_token }
  });
  assert.equal(userinfoRes.status, 200);
  const userinfo = await userinfoRes.json();
  assert.equal(userinfo.sub, jwt.payload.sub);
  assert.equal(userinfo.preferred_username, 'genhub-owner');
  assert.equal(userinfo.name, 'owner');
  assert.equal(userinfo.email, jwt.payload.email);
  assert.deepEqual(userinfo.groups, ['genhub-owner']);

  // Invalid bearer token on userinfo returns 401
  const badTokenRes = await fetch(x.origin + '/oidc/owner/userinfo', {
    headers: { Authorization: 'Bearer wrong-token' }
  });
  assert.equal(badTokenRes.status, 401);
});

test('Owner OIDC: client authentication and PKCE validation', async t => {
  const x = await fixture(t);
  const creds = provisionOwnerOidc(x.hub.store, x.origin);
  const callback = x.origin + '/gitea/user/oauth2/' + OWNER_OIDC_SOURCE + '/callback';

  // PKCE setup
  const verifier = 'a'.repeat(43);
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  const authRes = await x.call(
    '/oidc/owner/authorize?' +
      new URLSearchParams({
        client_id: OWNER_OIDC_CLIENT,
        redirect_uri: callback,
        response_type: 'code',
        scope: 'openid profile',
        code_challenge: challenge,
        code_challenge_method: 'S256'
      })
  );
  const code = new URL(authRes.headers.get('location')).searchParams.get('code');

  // Wrong client secret -> 401
  const wrongSecret = await fetch(x.origin + '/oidc/owner/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: OWNER_OIDC_CLIENT,
      client_secret: 'incorrect-secret',
      code,
      redirect_uri: callback
    })
  });
  assert.equal(wrongSecret.status, 401);

  // Wrong code verifier -> 400 invalid_grant
  const wrongVerifier = await fetch(x.origin + '/oidc/owner/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: OWNER_OIDC_CLIENT,
      client_secret: creds.client_secret,
      code_verifier: 'wrong-verifier-12345678901234567890123456789012',
      code,
      redirect_uri: callback
    })
  });
  assert.equal(wrongVerifier.status, 400);

  // Correct PKCE exchange via client_secret_post
  const okRes = await fetch(x.origin + '/oidc/owner/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: OWNER_OIDC_CLIENT,
      client_secret: creds.client_secret,
      code_verifier: verifier,
      code,
      redirect_uri: callback
    })
  });
  assert.equal(okRes.status, 200);
});

test('Owner OIDC: RP-Initiated logout and security boundaries', async t => {
  const x = await fixture(t);
  provisionOwnerOidc(x.hub.store, x.origin);

  // 1. GET /oidc/owner/logout with invalid client or redirect_uri fails
  const badLogout = await fetch(
    x.origin + '/oidc/owner/logout?client_id=bad&post_logout_redirect_uri=https://evil.com'
  );
  assert.equal(badLogout.status, 400);

  // 2. GET /oidc/owner/logout without session redirects 302 to /gitea/
  const unauthedLogout = await fetch(
    x.origin +
      '/oidc/owner/logout?client_id=' +
      OWNER_OIDC_CLIENT +
      '&post_logout_redirect_uri=' +
      encodeURIComponent(x.origin + '/gitea/'),
    {
      redirect: 'manual'
    }
  );
  assert.equal(unauthedLogout.status, 302);
  assert.equal(unauthedLogout.headers.get('location'), '/gitea/');

  // 3. GET /oidc/owner/logout with session shows confirmation page
  const loginRes = await x.call('/api/login', 'POST', {
    username: 'owner',
    password: 'owner-password-123'
  });
  const cookie = loginRes.headers.get('set-cookie').split(';')[0];
  const csrf = loginRes.data.csrf;
  const getLogout = await fetch(
    x.origin +
      '/oidc/owner/logout?client_id=' +
      OWNER_OIDC_CLIENT +
      '&post_logout_redirect_uri=' +
      encodeURIComponent(x.origin + '/gitea/'),
    {
      headers: { Cookie: cookie },
      redirect: 'manual'
    }
  );
  assert.equal(getLogout.status, 200);
  assert.ok(getLogout.headers.get('content-type').includes('text/html'));
  const html = await getLogout.text();
  assert.ok(html.includes('Đã đăng xuất Gitea'));

  // 4. POST /oidc/owner/logout with CSRF logs out and redirects to /gitea/
  const postLogout = await fetch(x.origin + '/oidc/owner/logout', {
    method: 'POST',
    headers: {
      Origin: x.origin,
      'Content-Type': 'application/json',
      Cookie: cookie
    },
    body: JSON.stringify({ csrf }),
    redirect: 'manual'
  });
  assert.equal(postLogout.status, 303);
  assert.equal(postLogout.headers.get('location'), '/gitea/');

  // 5. Session is invalidated
  const afterLogout = await x.call('/api/state', 'GET', undefined, { Cookie: cookie });
  assert.equal(afterLogout.status, 401);
});
