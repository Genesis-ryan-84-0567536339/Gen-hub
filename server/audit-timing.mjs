import { AsyncLocalStorage } from 'node:async_hooks';
const context = new AsyncLocalStorage();
export const withAuditTiming = (phases, fn) => context.run(phases, fn);
export async function measurePhase(name, fn) {
  const phases = context.getStore();
  if (!phases) return fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    phases[name] = (phases[name] || 0) + performance.now() - start;
  }
}
