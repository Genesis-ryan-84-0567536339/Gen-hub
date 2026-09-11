import { generateKeyPairSync, createPublicKey, createPrivateKey, sign, createHash, timingSafeEqual } from 'node:crypto';
import { secret, digest } from './store.mjs';
import { HubError } from './net.mjs';

export const OWNER_SESSION_SECONDS = 30 * 24 * 60 * 60;
export const OWNER_OIDC_CLIENT = 'genhub-gitea';
export const OWNER_OIDC_SOURCE = 'genhub-owner';
const prefix = '/oidc/owner';

// Provisioned by the root CLI, never by an agent API or dynamic client registration.
// Only this dedicated client secret crosses into Gitea. Signing keys stay encrypted in Hub.
export function provisionOwnerOidc(store, origin, rotate = false) {
  if (!store.get('owner', 'main')) throw new Error('Thiếu owner Hub');
  return store.tx(() => {
    let config = store.get('owner-oidc', 'main');
    if (config && config.origin !== origin && !rotate) throw new Error('OIDC origin đã đổi; khôi phục origin từ backup');
    if (!config || rotate) {
      const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      config = {
        origin,
        subject: config?.subject || ('owner-' + secret()),
        kid: secret(),
        jwk: publicKey.export({ format: 'jwk' }),
        privateKey: store.seal(privateKey.export({ format: 'pem', type: 'pkcs8' })),
        clientSecret: store.seal(secret() + secret())
      };
      store.put('owner-oidc', 'main', config);
    }
    return { client_id: OWNER_OIDC_CLIENT, client_secret: store.unseal(config.clientSecret),
      discovery_url: origin + prefix + '/.well-known/openid-configuration' };
  });
}

export function ownerOidcService(store, auth, origin) {
  const issuer = origin + prefix;
  const callback = origin + '/gitea/user/oauth2/' + OWNER_OIDC_SOURCE + '/callback';
  const config = () => {
    const c = store.get('owner-oidc', 'main');
    if (!c || c.origin !== origin) throw new HubError('SSO chưa bootstrap; chạy sudo gen-hub gitea-enable', 503);
    return c;
  };
  const liveSession = id => {
    const s = store.get('session', id);
    if (!s || s.expires <= Date.now()) throw new HubError('invalid_grant');
    return s;
  };
  const identity = () => ({ sub: config().subject, preferred_username: 'genhub-owner',
    name: store.get('owner', 'main').username,
    email: config().subject + '@sso.localhost.invalid', email_verified: true,
    groups: ['genhub-owner'] });
  function validate(q) {
    config();
    if (q.client_id !== OWNER_OIDC_CLIENT || q.redirect_uri !== callback || q.response_type !== 'code' ||
        !q.scope?.split(' ').includes('openid') || q.scope.split(' ').some(s => !['openid', 'profile', 'email', 'groups'].includes(s)) ||
        (q.nonce !== undefined && (!q.nonce || q.nonce.length > 512)) ||
        (q.state !== undefined && q.state.length > 2048) ||
        (q.code_challenge !== undefined && (q.code_challenge_method !== 'S256' || !/^[\w-]{43}$/.test(q.code_challenge))) ||
        (q.code_challenge_method && !q.code_challenge) ||
        (q.prompt && !['none', 'login'].includes(q.prompt)) || q.max_age !== undefined)
      throw new HubError('invalid_request');
    return q;
  }
  function code(q, s) {
    const raw = secret() + secret();
    store.put('owner-oidc-code', digest(raw), { id: digest(raw), session: s.id,
      nonce: q.nonce, challenge: q.code_challenge, expires: Math.min(s.expires, Date.now() + 60000) });
    const url = new URL(callback);
    url.searchParams.set('code', raw);
    if (q.state !== undefined) url.searchParams.set('state', q.state);
    store.audit('owner', 'hub', 'owner.sso', 'success', { client: OWNER_OIDC_CLIENT }, { authorized: true });
    return url.href;
  }
  function authorize(q, req) {
    validate(q);
    const s = auth.session(req);
    if (s && q.prompt !== 'login') return code(q, s);
    if (q.prompt === 'none') {
      const url = new URL(callback);
      url.searchParams.set('error', 'login_required');
      if (q.state !== undefined) url.searchParams.set('state', q.state);
      return url.href;
    }
    // A server-side flow keeps callback/nonce out of the login UI and is one-time.
    const raw = secret() + secret();
    store.put('owner-oidc-flow', digest(raw), { id: digest(raw), q, previousSession: s?.id,
      expires: Date.now() + 10 * 60000 });
    return '/#gitea/' + raw;
  }
  function resume(raw, req) {
    return store.tx(() => {
      const f = store.get('owner-oidc-flow', digest(raw));
      if (!f || f.expires <= Date.now()) throw new HubError('Yêu cầu SSO đã hết hạn');
      const s = auth.owner(req);
      if (s.id === f.previousSession) throw new HubError('Hãy đăng nhập lại để tiếp tục SSO', 401);
      validate(f.q);
      store.del('owner-oidc-flow', f.id);
      return code(f.q, s);
    });
  }
  function authenticateClient(b, req) {
    let id = b.client_id, credential = b.client_secret;
    if (req.headers.authorization) {
      if (b.client_secret !== undefined || !/^Basic [A-Za-z0-9+/]+=*$/i.test(req.headers.authorization))
        throw new HubError('invalid_client', 401);
      const decoded = Buffer.from(req.headers.authorization.slice(6), 'base64').toString();
      const sep = decoded.indexOf(':');
      try {
        id = decodeURIComponent(decoded.slice(0, sep));
        credential = decodeURIComponent(decoded.slice(sep + 1));
      } catch { throw new HubError('invalid_client', 401); }
      if (sep < 0 || (b.client_id && b.client_id !== id)) throw new HubError('invalid_client', 401);
    }
    if (id !== OWNER_OIDC_CLIENT || typeof credential !== 'string' || credential.length > 1024 ||
        !timingSafeEqual(Buffer.from(digest(credential)), Buffer.from(digest(store.unseal(config().clientSecret)))))
      throw new HubError('invalid_client', 401);
  }
  function exchange(b, req) {
    authenticateClient(b, req);
    return store.tx(() => {
      if (b.grant_type !== 'authorization_code') throw new HubError('unsupported_grant_type');
      const c = store.get('owner-oidc-code', digest(String(b.code || '')));
      if (!c || c.expires <= Date.now() || b.redirect_uri !== callback) throw new HubError('invalid_grant');
      const s = liveSession(c.session);
      if (c.challenge && (!/^[A-Za-z0-9._~-]{43,128}$/.test(b.code_verifier || '') ||
          createHash('sha256').update(b.code_verifier).digest('base64url') !== c.challenge)) throw new HubError('invalid_grant');
      store.del('owner-oidc-code', c.id);
      const now = Math.floor(Date.now() / 1000), exp = Math.min(now + 300, Math.floor(s.expires / 1000));
      const access = secret() + secret();
      store.put('owner-oidc-token', digest(access), { id: digest(access), session: s.id, expires: exp * 1000 });
      const cfg = config();
      const claims = { ...identity(), iss: issuer, aud: OWNER_OIDC_CLIENT, iat: now, exp,
        auth_time: Math.floor((s.created || s.expires - OWNER_SESSION_SECONDS * 1000) / 1000),
        at_hash: createHash('sha256').update(access).digest().subarray(0, 16).toString('base64url'),
        ...(c.nonce !== undefined ? { nonce: c.nonce } : {}) };
      const jwt = [ { alg: 'RS256', typ: 'JWT', kid: cfg.kid }, claims ]
        .map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
      return { access_token: access, token_type: 'Bearer', expires_in: exp - now,
        id_token: jwt + '.' + sign('RSA-SHA256', Buffer.from(jwt), createPrivateKey(store.unseal(cfg.privateKey))).toString('base64url') };
    });
  }
  function userinfo(req) {
    const raw = req.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
    const t = raw && store.get('owner-oidc-token', digest(raw));
    if (!t || t.expires <= Date.now()) throw new HubError('invalid_token', 401);
    try { liveSession(t.session); } catch { throw new HubError('invalid_token', 401); }
    return identity();
  }
  return { authorize, resume, exchange, userinfo,
    jwks: () => { const c = config(); return { keys: [{ ...c.jwk, kid: c.kid, alg: 'RS256', use: 'sig' }] }; },
    metadata: () => { config(); return {
      issuer, authorization_endpoint: issuer + '/authorize', token_endpoint: issuer + '/token',
      userinfo_endpoint: issuer + '/userinfo', jwks_uri: issuer + '/jwks', end_session_endpoint: issuer + '/logout',
      response_types_supported: ['code'], subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'], grant_types_supported: ['authorization_code'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      scopes_supported: ['openid', 'profile', 'email', 'groups'], code_challenge_methods_supported: ['S256']
    }; }
  };
}
