import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import { isIP } from 'node:net';
export function sanitizeErrorMessage(msg) {
  if (typeof msg !== 'string') msg = String(msg ?? '');
  let s = msg
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/(https?:\/\/)([^:\/\s]+):([^@\/\s]+)@/g, '$1$2:[REDACTED]@')
    .replace(/\b(ghp|gho|ghu|ghs|ghr|glpat)_[A-Za-z0-9]{16,}\b/g, '[REDACTED]')
    .replace(/\b(sk-[A-Za-z0-9]{16,})\b/g, '[REDACTED]')
    .replace(/([?&](?:token|access_token|api_key|apiKey|secret|password)=)[^&]+/gi, '$1[REDACTED]');
  if (s.length > 500) {
    s = s.slice(0, 497) + '...';
  }
  return s;
}

export function defaultCategoryForStatus(status, upstreamStatus) {
  if (status === 400 && !upstreamStatus) return 'validation';
  if (status === 401) return 'authentication';
  if (status === 403) return 'denied';
  if (status === 429) return 'rate_limit';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 502 || status === 503) {
    return [409, 422].includes(upstreamStatus) ? 'upstream_tool_conflict' : 'upstream_transport';
  }
  return 'internal';
}

export function defaultCodeForStatus(status, category) {
  if (status === 504) return 'GATEWAY_TIMEOUT';
  if (status === 408 || category === 'timeout') return 'TIMEOUT';
  if (category === 'validation' || status === 400) return 'VALIDATION_ERROR';
  if (category === 'authentication' || status === 401) return 'UNAUTHORIZED';
  if (category === 'denied' || status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (category === 'rate_limit' || status === 429) return 'RATE_LIMITED';
  if (status === 409) return 'CONFLICT';
  if (status === 422) return 'UNPROCESSABLE_ENTITY';
  if (status === 502) return 'BAD_GATEWAY';
  if (status === 503) return 'SERVICE_UNAVAILABLE';
  return 'INTERNAL_ERROR';
}

export function isRetryableStatus(status, upstreamStatus, category) {
  if (['validation', 'denied', 'authentication'].includes(category)) return false;
  if (status === 429) return true;
  if (status === 408 || status === 504 || category === 'timeout') return true;
  if (status === 502 || status === 503) return true;
  return false;
}

export class HubError extends Error {
  constructor(message, statusOrOptions = 400, options = {}) {
    const opts = typeof statusOrOptions === 'number'
      ? { status: statusOrOptions, ...options }
      : (statusOrOptions || {});
    const rawMessage = typeof message === 'string' ? message : String(message ?? '');
    const cleanMsg = sanitizeErrorMessage(rawMessage);
    super(cleanMsg);
    this.name = this.constructor.name;
    this.status = opts.status ?? 400;
    this.upstreamStatus = opts.upstreamStatus !== undefined ? opts.upstreamStatus : null;
    this.category = opts.category || defaultCategoryForStatus(this.status, this.upstreamStatus);
    this.code = opts.code || defaultCodeForStatus(this.status, this.category);
    this.retryable = opts.retryable !== undefined ? Boolean(opts.retryable) : isRetryableStatus(this.status, this.upstreamStatus, this.category);
  }

  get errorCategory() {
    return this.category;
  }
  set errorCategory(val) {
    this.category = val;
  }

  toJSON() {
    return {
      category: this.category,
      code: this.code,
      status: this.status,
      upstreamStatus: this.upstreamStatus,
      retryable: this.retryable,
      message: this.message
    };
  }
}
export function privateIP(ip) {
  if (ip.startsWith('::ffff:')) {
    const tail = ip.slice(7);
    if (tail.includes('.')) return privateIP(tail);
    const v = tail.split(':');
    if (v.length === 2) {
      const n = parseInt(v[0], 16) * 65536 + parseInt(v[1], 16);
      return privateIP([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
    }
    return true;
  }
  if (isIP(ip) === 6) return !/^[23][0-9a-f]{3}:/i.test(ip);
  const n = ip.split('.').map(Number);
  return (
    n[0] === 0 ||
    n[0] === 10 ||
    n[0] === 127 ||
    n[0] >= 224 ||
    (n[0] === 169 && n[1] === 254) ||
    (n[0] === 172 && n[1] >= 16 && n[1] <= 31) ||
    (n[0] === 192 && n[1] === 168) ||
    (n[0] === 100 && n[1] >= 64 && n[1] <= 127)
  );
}
export async function request(
  url,
  {
    method = 'GET',
    headers = {},
    body,
    allowPrivate = false,
    maxBytes = 4 * 1024 * 1024,
    timeout = 30000,
    responseId,
    signal
  } = {}
) {
  const u = new URL(url);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password)
    throw new HubError('Địa chỉ HTTP/HTTPS không hợp lệ');
  const host = u.hostname.replace(/^\[|\]$/g, ''),
    addresses = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await dns.lookup(host, { all: true });
  if (!addresses.length || (!allowPrivate && addresses.some(a => privateIP(a.address))))
    throw new HubError('Địa chỉ mạng riêng chưa được owner cho phép');
  if (addresses.some(a => a.address === '169.254.169.254' || a.address === '169.254.170.2'))
    throw new HubError('Địa chỉ metadata bị chặn');
  const data =
    body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const req = (u.protocol === 'https:' ? https : http).request(
      u,
      {
        method,
        headers: {
          'User-Agent': 'Gen-hub/0.1',
          ...(data
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
            : {}),
          ...headers
        },
        lookup: (hostname, opts, cb) =>
          opts.all ? cb(null, addresses) : cb(null, addresses[0].address, addresses[0].family)
      },
      res => {
        res.on('data', c => {
          size += c.length;
          if (size > maxBytes) {
            req.destroy(new HubError('Phản hồi vượt giới hạn 4 MiB', 502));
            return;
          }
          chunks.push(c);
          if (
            responseId !== undefined &&
            res.headers['content-type']?.includes('text/event-stream')
          ) {
            const text = Buffer.concat(chunks).toString('utf8');
            for (const event of text.split(/\r?\n\r?\n/).slice(0, -1)) {
              const data = event
                .split(/\r?\n/)
                .filter(l => l.startsWith('data:'))
                .map(l => l.slice(5).trim())
                .join('\n');
              try {
                const json = JSON.parse(data);
                if (json.id === responseId) {
                  resolve({ status: res.statusCode, headers: res.headers, text, json });
                  req.destroy();
                  return;
                }
              } catch {}
            }
          }
        });
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          try {
            json = JSON.parse(text);
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
        res.on('error', reject);
      }
    );
    const timer = setTimeout(
      () => req.destroy(new HubError('Dịch vụ không phản hồi trong thời hạn', 504)),
      timeout
    );
    req.on('close', () => clearTimeout(timer));
    if (signal) {
      if (signal.aborted) {
        req.destroy(new HubError('Yêu cầu đã bị hủy', 499));
        return reject(new HubError('Yêu cầu đã bị hủy', 499));
      }
      const onAbort = () => req.destroy(new HubError('Yêu cầu đã bị hủy', 499));
      signal.addEventListener('abort', onAbort, { once: true });
      req.on('close', () => signal.removeEventListener('abort', onAbort));
    }
    req.on('error', reject);
    req.end(data);
  });
}
export async function jsonRequest(url, options) {
  const r = await request(url, options);
  if (r.status < 200 || r.status >= 300)
    throw new HubError(
      `Dịch vụ trả HTTP ${r.status}`,
      {
        status: r.status === 401 ? 401 : r.status === 403 ? 403 : 502,
        upstreamStatus: r.status
      }
    );
  if (r.json?.ok === false || r.json?.error) {
    const isMissingScope = r.json?.error === 'missing_scope';
    const errText = isMissingScope
      ? `Dịch vụ từ chối: thiếu scope ${r.json.needed || ''}`.trim()
      : 'Dịch vụ từ chối: ' +
        String(r.json.error?.message || r.json.error || r.json.description).slice(0, 300);
    throw new HubError(errText, {
      status: isMissingScope ? 403 : 502,
      upstreamStatus: r.status
    });
  }
  return r.json ?? { text: r.text };
}

export class ValidationError extends HubError {
  constructor(message, options = {}) {
    const opts = typeof options === 'string' ? { code: options } : options;
    super(message, {
      status: 400,
      category: 'validation',
      code: opts.code || 'VALIDATION_ERROR',
      upstreamStatus: null,
      retryable: false,
      ...opts
    });
  }
}

function deepEquals(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEquals(item, b[i]));
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(k => Object.prototype.hasOwnProperty.call(b, k) && deepEquals(a[k], b[k]));
}

export const SUPPORTED_SCHEMA_KEYWORDS = [
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
  'enum',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'pattern',
  'nullable',
  'oneOf',
  'anyOf'
];

function validateSchemaValue(schema, val, path = '') {
  if (!schema || typeof schema !== 'object') return;
  const label = path || 'Giá trị';

  if (Array.isArray(schema.oneOf)) {
    let matches = 0;
    for (const sub of schema.oneOf) {
      try {
        validateSchemaValue(sub, val, path);
        matches++;
      } catch {}
    }
    if (matches !== 1) {
      throw new ValidationError(`${label} không khớp với đúng một schema trong oneOf (${matches} khớp)`);
    }
    return;
  }

  if (Array.isArray(schema.anyOf)) {
    let matched = false;
    for (const sub of schema.anyOf) {
      try {
        validateSchemaValue(sub, val, path);
        matched = true;
        break;
      } catch {}
    }
    if (!matched) {
      throw new ValidationError(`${label} không khớp với bất kỳ schema nào trong anyOf`);
    }
    return;
  }

  if (val === null) {
    const allowsNull =
      schema.nullable === true ||
      schema.type === 'null' ||
      (Array.isArray(schema.type) && schema.type.includes('null'));
    if (!allowsNull) {
      throw new ValidationError(`${label} không được là null`);
    }
    return;
  }

  if (Array.isArray(schema.enum)) {
    const match = schema.enum.some(opt => deepEquals(opt, val));
    if (!match) {
      const allowed = schema.enum
        .map(x => (typeof x === 'string' ? `'${x}'` : JSON.stringify(x)))
        .join(', ');
      throw new ValidationError(`${label} phải là một trong các giá trị: ${allowed}`);
    }
  }

  const allowedTypes = Array.isArray(schema.type)
    ? schema.type
    : schema.type
      ? [schema.type]
      : [];

  if (allowedTypes.length > 0) {
    let typeMatches = false;
    for (const t of allowedTypes) {
      if (t === 'string' && typeof val === 'string') typeMatches = true;
      else if (t === 'integer' && Number.isSafeInteger(val)) typeMatches = true;
      else if (t === 'number' && typeof val === 'number' && Number.isFinite(val)) typeMatches = true;
      else if (t === 'boolean' && typeof val === 'boolean') typeMatches = true;
      else if (t === 'array' && Array.isArray(val)) typeMatches = true;
      else if (t === 'object' && val && typeof val === 'object' && !Array.isArray(val)) typeMatches = true;
      else if (t === 'null' && val === null) typeMatches = true;
    }
    if (!typeMatches) {
      if (allowedTypes.length === 1) {
        const t = allowedTypes[0];
        if (t === 'string') throw new ValidationError(`${label} phải là chuỗi`);
        if (t === 'integer') throw new ValidationError(`${label} ngoài phạm vi`);
        if (t === 'number') throw new ValidationError(`${label} ngoài phạm vi`);
        if (t === 'boolean') throw new ValidationError(`${label} phải là boolean`);
        if (t === 'array') throw new ValidationError(`${label} phải là mảng`);
        if (t === 'object') throw new ValidationError(`${label} phải là object`);
      }
      throw new ValidationError(`${label} không đúng kiểu dữ liệu (${allowedTypes.join(' | ')})`);
    }
  }

  if (typeof val === 'string') {
    const max = schema.maxLength ?? 100000;
    if (val.length > max) throw new ValidationError(`${label} ngoài phạm vi`);
    if (schema.minLength !== undefined && val.length < schema.minLength) {
      throw new ValidationError(`${label} ngoài phạm vi`);
    }
    if (schema.pattern) {
      const regex = typeof schema.pattern === 'string' ? new RegExp(schema.pattern) : schema.pattern;
      if (!regex.test(val)) throw new ValidationError(`${label} không đúng định dạng`);
    }
  }

  if (typeof val === 'number') {
    if (schema.type === 'integer' && !Number.isSafeInteger(val)) {
      throw new ValidationError(`${label} ngoài phạm vi`);
    }
    if (schema.minimum !== undefined && val < schema.minimum) {
      throw new ValidationError(`${label} ngoài phạm vi`);
    }
    if (schema.maximum !== undefined && val > schema.maximum) {
      throw new ValidationError(`${label} ngoài phạm vi`);
    }
    if (schema.exclusiveMinimum !== undefined && val <= schema.exclusiveMinimum) {
      throw new ValidationError(`${label} ngoài phạm vi`);
    }
    if (schema.exclusiveMaximum !== undefined && val >= schema.exclusiveMaximum) {
      throw new ValidationError(`${label} ngoài phạm vi`);
    }
  }

  if (Array.isArray(val)) {
    if (schema.minItems !== undefined && val.length < schema.minItems) {
      throw new ValidationError(`${label} ngoài phạm vi`);
    }
    if (schema.maxItems !== undefined && val.length > schema.maxItems) {
      throw new ValidationError(`${label} ngoài phạm vi`);
    }
    if (schema.uniqueItems) {
      for (let i = 0; i < val.length; i++) {
        for (let j = i + 1; j < val.length; j++) {
          if (deepEquals(val[i], val[j])) {
            throw new ValidationError(`${label} chứa phần tử trùng lặp`);
          }
        }
      }
    }
    if (schema.items) {
      for (let i = 0; i < val.length; i++) {
        const elemPath = path ? `${path}[${i}]` : `[${i}]`;
        validateSchemaValue(schema.items, val[i], elemPath);
      }
    }
  }

  if (val && typeof val === 'object' && !Array.isArray(val)) {
    for (const k of schema.required || []) {
      if (val[k] === undefined) {
        throw new ValidationError('Thiếu tham số ' + (path ? `${path}.${k}` : k));
      }
    }
    for (const [k, v] of Object.entries(val)) {
      const propPath = path ? `${path}.${k}` : k;
      const p = schema.properties?.[k];
      if (!p) {
        if (schema.additionalProperties === false) {
          throw new ValidationError('Tham số không hỗ trợ: ' + propPath);
        }
        if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
          validateSchemaValue(schema.additionalProperties, v, propPath);
        }
        continue;
      }
      if (v !== undefined) {
        validateSchemaValue(p, v, propPath);
      }
    }
  }
}

export function assertSchema(schema, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args))
    throw new ValidationError('Arguments phải là object');
  if (!schema || typeof schema !== 'object' || Array.isArray(schema))
    throw new ValidationError('Schema không hợp lệ');
  validateSchemaValue(schema, args, '');
}

