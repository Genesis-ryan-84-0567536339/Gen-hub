import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HubError,
  ValidationError,
  assertSchema,
  sanitizeErrorMessage,
  SUPPORTED_SCHEMA_KEYWORDS
} from '../server/net.mjs';

test('C2 Contract: supported schema keywords are published', () => {
  assert.ok(Array.isArray(SUPPORTED_SCHEMA_KEYWORDS));
  assert.ok(SUPPORTED_SCHEMA_KEYWORDS.includes('enum'));
  assert.ok(SUPPORTED_SCHEMA_KEYWORDS.includes('items'));
  assert.ok(SUPPORTED_SCHEMA_KEYWORDS.includes('nullable'));
  assert.ok(SUPPORTED_SCHEMA_KEYWORDS.includes('oneOf'));
  assert.ok(SUPPORTED_SCHEMA_KEYWORDS.includes('anyOf'));
});

test('C2 Contract: root arguments validation', () => {
  assert.throws(() => assertSchema({}, null), ValidationError);
  assert.throws(() => assertSchema({}, undefined), ValidationError);
  assert.throws(() => assertSchema({}, 'string'), ValidationError);
  assert.throws(() => assertSchema({}, [1, 2]), ValidationError);
  assert.doesNotThrow(() => assertSchema({}, {}));
});

test('C2 Contract: primitive types and bounds', () => {
  const schema = {
    type: 'object',
    properties: {
      str: { type: 'string', minLength: 2, maxLength: 5, pattern: '^[a-z]+$' },
      int: { type: 'integer', minimum: 10, maximum: 20 },
      num: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 10 },
      flag: { type: 'boolean' }
    }
  };

  // Valid
  assert.doesNotThrow(() =>
    assertSchema(schema, { str: 'abc', int: 15, num: 5.5, flag: true })
  );

  // String invalid type
  assert.throws(() => assertSchema(schema, { str: 123 }), /str phải là chuỗi/);
  // String minLength violation
  assert.throws(() => assertSchema(schema, { str: 'a' }), /str ngoài phạm vi/);
  // String maxLength violation
  assert.throws(() => assertSchema(schema, { str: 'abcdef' }), /str ngoài phạm vi/);
  // String pattern violation
  assert.throws(() => assertSchema(schema, { str: 'ABC' }), /str không đúng định dạng/);

  // Integer violations
  assert.throws(() => assertSchema(schema, { int: 9 }), /int ngoài phạm vi/);
  assert.throws(() => assertSchema(schema, { int: 21 }), /int ngoài phạm vi/);
  assert.throws(() => assertSchema(schema, { int: 15.5 }), /int ngoài phạm vi/);

  // Number violations
  assert.throws(() => assertSchema(schema, { num: 0 }), /num ngoài phạm vi/);
  assert.throws(() => assertSchema(schema, { num: 10 }), /num ngoài phạm vi/);
  assert.throws(() => assertSchema(schema, { num: 'not-a-number' }), /num ngoài phạm vi/);

  // Boolean violation
  assert.throws(() => assertSchema(schema, { flag: 'true' }), /flag phải là boolean/);
});

test('C2 Contract: enum validation with clear Vietnamese error message', () => {
  const schema = {
    type: 'object',
    properties: {
      state: { type: 'string', enum: ['open', 'closed'] },
      priority: { type: 'integer', enum: [1, 2, 3] }
    }
  };

  assert.doesNotThrow(() => assertSchema(schema, { state: 'open', priority: 1 }));
  assert.doesNotThrow(() => assertSchema(schema, { state: 'closed', priority: 3 }));

  assert.throws(
    () => assertSchema(schema, { state: 'pending' }),
    err => {
      assert.ok(err instanceof ValidationError);
      assert.match(err.message, /state phải là/);
      assert.match(err.message, /'open', 'closed'/);
      return true;
    }
  );

  assert.throws(
    () => assertSchema(schema, { priority: 4 }),
    /priority phải là một trong các giá trị: 1, 2, 3/
  );
});

test('C2 Contract: array validation, min/max items, uniqueItems, and recursive items', () => {
  const schema = {
    type: 'object',
    properties: {
      tags: {
        type: 'array',
        minItems: 1,
        maxItems: 3,
        uniqueItems: true,
        items: { type: 'string' }
      },
      files: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            operation: { type: 'string', enum: ['create', 'update', 'delete'] }
          },
          required: ['path', 'operation'],
          additionalProperties: false
        }
      }
    }
  };

  // Valid
  assert.doesNotThrow(() =>
    assertSchema(schema, {
      tags: ['bug', 'ui'],
      files: [
        { path: 'a.txt', operation: 'create' },
        { path: 'b.txt', operation: 'delete' }
      ]
    })
  );

  // Array type violation
  assert.throws(() => assertSchema(schema, { tags: 'not-array' }), /tags phải là mảng/);

  // minItems violation
  assert.throws(() => assertSchema(schema, { tags: [] }), /tags ngoài phạm vi/);

  // maxItems violation
  assert.throws(() => assertSchema(schema, { tags: ['1', '2', '3', '4'] }), /tags ngoài phạm vi/);

  // uniqueItems violation
  assert.throws(() => assertSchema(schema, { tags: ['duplicate', 'duplicate'] }), /tags chứa phần tử trùng lặp/);

  // Nested array element primitive type violation
  assert.throws(() => assertSchema(schema, { tags: ['valid', 123] }), /tags\[1\] phải là chuỗi/);

  // Nested array element object required violation
  assert.throws(
    () => assertSchema(schema, { files: [{ path: 'a.txt' }] }),
    /Thiếu tham số files\[0\]\.operation/
  );

  // Nested array element enum violation
  assert.throws(
    () => assertSchema(schema, { files: [{ path: 'a.txt', operation: 'archive' }] }),
    /files\[0\]\.operation phải là một trong các giá trị: 'create', 'update', 'delete'/
  );

  // Nested array element additionalProperties violation
  assert.throws(
    () => assertSchema(schema, { files: [{ path: 'a.txt', operation: 'create', extra: 1 }] }),
    /Tham số không hỗ trợ: files\[0\]\.extra/
  );
});

test('C2 Contract: nested objects and additionalProperties', () => {
  const schema = {
    type: 'object',
    properties: {
      meta: {
        type: 'object',
        properties: {
          author: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              email: { type: 'string' }
            },
            required: ['name'],
            additionalProperties: false
          }
        },
        required: ['author'],
        additionalProperties: false
      }
    },
    required: ['meta'],
    additionalProperties: false
  };

  assert.doesNotThrow(() =>
    assertSchema(schema, {
      meta: {
        author: { name: 'Ryan', email: 'ryan@example.com' }
      }
    })
  );

  assert.throws(() => assertSchema(schema, {}), /Thiếu tham số meta/);
  assert.throws(() => assertSchema(schema, { meta: {} }), /Thiếu tham số meta\.author/);
  assert.throws(() => assertSchema(schema, { meta: { author: {} } }), /Thiếu tham số meta\.author\.name/);
  assert.throws(
    () => assertSchema(schema, { meta: { author: { name: 'Ryan', unknown: 123 } } }),
    /Tham số không hỗ trợ: meta\.author\.unknown/
  );
  assert.throws(
    () => assertSchema(schema, { rootExtra: 1, meta: { author: { name: 'Ryan' } } }),
    /Tham số không hỗ trợ: rootExtra/
  );
});

test('C2 Contract: null and nullable support', () => {
  const schema = {
    type: 'object',
    properties: {
      strictStr: { type: 'string' },
      nullableStr: { type: 'string', nullable: true },
      unionNull: { type: ['string', 'null'] },
      pureNull: { type: 'null' }
    }
  };

  // Valid
  assert.doesNotThrow(() =>
    assertSchema(schema, {
      strictStr: 'ok',
      nullableStr: null,
      unionNull: null,
      pureNull: null
    })
  );
  assert.doesNotThrow(() =>
    assertSchema(schema, {
      strictStr: 'ok',
      nullableStr: 'valid',
      unionNull: 'valid',
      pureNull: null
    })
  );

  // Rejects null when not allowed
  assert.throws(
    () => assertSchema(schema, { strictStr: null }),
    /strictStr không được là null/
  );

  // Rejects non-null for pureNull
  assert.throws(
    () => assertSchema(schema, { pureNull: 'not-null' }),
    /pureNull không đúng kiểu dữ liệu/
  );
});

test('C2 Contract: oneOf and anyOf unions', () => {
  const schema = {
    type: 'object',
    properties: {
      target: {
        oneOf: [
          {
            type: 'object',
            properties: { id: { type: 'integer' } },
            required: ['id'],
            additionalProperties: false
          },
          {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
            additionalProperties: false
          }
        ]
      }
    }
  };

  // Exactly one matches
  assert.doesNotThrow(() => assertSchema(schema, { target: { id: 10 } }));
  assert.doesNotThrow(() => assertSchema(schema, { target: { name: 'alpha' } }));

  // Both match -> oneOf rejects
  assert.throws(() => assertSchema(schema, { target: { id: 10, name: 'alpha' } }), /oneOf/);

  // Neither matches -> oneOf rejects
  assert.throws(() => assertSchema(schema, { target: { foo: 'bar' } }), /oneOf/);
});

test('C2 Contract: standardized HubError and ValidationError attributes', () => {
  const valErr = new ValidationError('Tham số không đúng', { code: 'INVALID_QUERY' });
  assert.equal(valErr.name, 'ValidationError');
  assert.equal(valErr.status, 400);
  assert.equal(valErr.category, 'validation');
  assert.equal(valErr.errorCategory, 'validation'); // backwards-compatible alias
  assert.equal(valErr.code, 'INVALID_QUERY');
  assert.equal(valErr.upstreamStatus, null);
  assert.equal(valErr.retryable, false);
  assert.equal(valErr.message, 'Tham số không đúng');

  const jsonVal = valErr.toJSON();
  assert.deepEqual(jsonVal, {
    category: 'validation',
    code: 'INVALID_QUERY',
    status: 400,
    upstreamStatus: null,
    retryable: false,
    message: 'Tham số không đúng'
  });

  // Upstream transport error
  const upErr = new HubError('Gitea 502', { status: 502, upstreamStatus: 502 });
  assert.equal(upErr.category, 'upstream_transport');
  assert.equal(upErr.code, 'BAD_GATEWAY');
  assert.equal(upErr.upstreamStatus, 502);
  assert.equal(upErr.retryable, true);

  // Upstream tool conflict
  const conflictErr = new HubError('Conflict in merge', { status: 502, upstreamStatus: 409 });
  assert.equal(conflictErr.category, 'upstream_tool_conflict');
  assert.equal(conflictErr.retryable, true);

  // Rate limit
  const rateErr = new HubError('Too Many Requests', 429);
  assert.equal(rateErr.category, 'rate_limit');
  assert.equal(rateErr.code, 'RATE_LIMITED');
  assert.equal(rateErr.retryable, true);

  // Timeout
  const timeoutErr = new HubError('Gateway timeout', 504);
  assert.equal(timeoutErr.category, 'timeout');
  assert.equal(timeoutErr.code, 'GATEWAY_TIMEOUT');
  assert.equal(timeoutErr.retryable, true);

  // Auth
  const authErr = new HubError('Unauthorized', 401);
  assert.equal(authErr.category, 'authentication');
  assert.equal(authErr.code, 'UNAUTHORIZED');
  assert.equal(authErr.retryable, false);

  // Denied
  const deniedErr = new HubError('Forbidden', 403);
  assert.equal(deniedErr.category, 'denied');
  assert.equal(deniedErr.code, 'FORBIDDEN');
  assert.equal(deniedErr.retryable, false);
});

test('C2 Contract: message sanitization strips credentials, bearer tokens, and secrets', () => {
  const secretBearer = 'Bearer ghp_1234567890abcdef1234567890';
  const urlWithCreds = 'Failed connecting to https://admin:supersecret@gitea.local/api/v1';
  const queryWithToken = 'GET /api?apiKey=sk-123456789012345678901234567890 failed';

  const err1 = new HubError(`Unauthorized request: ${secretBearer}`);
  assert.ok(!err1.message.includes('ghp_'));
  assert.ok(err1.message.includes('[REDACTED]'));

  const err2 = new HubError(urlWithCreds);
  assert.ok(!err2.message.includes('supersecret'));
  assert.ok(err2.message.includes('admin:[REDACTED]@gitea.local'));

  const err3 = new HubError(queryWithToken);
  assert.ok(!err3.message.includes('sk-'));
  assert.ok(err3.message.includes('[REDACTED]'));

  // Message length capping (anti-DoS / clean logs)
  const hugeMessage = 'A'.repeat(2000);
  const errHuge = new HubError(hugeMessage);
  assert.ok(errHuge.message.length <= 500);
  assert.ok(errHuge.message.endsWith('...'));
});
