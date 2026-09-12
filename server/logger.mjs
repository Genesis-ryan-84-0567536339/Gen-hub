export function createLogger(store) {
  function log(level, message, meta = {}) {
    const opId = store?.currentOperationId?.() || meta.operationId || null;
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message: typeof message === 'string' ? message : JSON.stringify(message),
      ...(opId ? { operationId: opId } : {}),
      ...meta
    };
    const line = JSON.stringify(entry);
    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
    return entry;
  }
  return {
    log,
    error: (msg, meta) => log('error', msg, meta),
    warn: (msg, meta) => log('warn', msg, meta),
    info: (msg, meta) => log('info', msg, meta)
  };
}
