import { HubError } from './net.mjs';

// connectors.call() trả kết quả bọc trong envelope kiểu MCP tools/call
// ({content:[{type:'text', text: JSON}], isError}) cho mọi provider REST
// thường (không phải remote MCP thật) — phải bóc ra mới lấy được dữ liệu.
export function unwrap(envelope, action) {
  const text = envelope?.content?.[0]?.text;
  let data;
  try {
    data = text !== undefined ? JSON.parse(text) : envelope;
  } catch {
    data = envelope;
  }
  if (envelope?.isError) throw new HubError(`${action} thất bại: ${data?.message || text || ''}`);
  return data;
}
