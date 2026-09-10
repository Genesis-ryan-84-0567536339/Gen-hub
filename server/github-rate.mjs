export function githubRetryAt(response, now = Date.now()) {
  const get = name => response.headers?.get?.(name);
  if (
    response.status !== 429 &&
    !(response.status === 403 && (get('x-ratelimit-remaining') === '0' || get('retry-after')))
  )
    return null;
  const retry = get('retry-after');
  const delay = retry && /^\d+$/.test(retry) ? now + Number(retry) * 1000 : Date.parse(retry || '');
  const reset = Number(get('x-ratelimit-reset')) * 1000;
  const next = Math.max(
    now + 60000,
    Number.isFinite(delay) ? delay : 0,
    Number.isFinite(reset) ? reset : 0
  );
  return new Date(next).toISOString();
}
