export const ALLOWED_CHAT_TOOLS = ['navigate', 'open_modal', 'highlight'];

export const ALLOWED_ROUTES = [
  'overview',
  'mcps',
  'agents',
  'vault',
  'audit',
  'kanban',
  'settings'
];

export const ALLOWED_MODAL_KINDS = [
  'add',
  'connect',
  'onboard',
  'credential',
  'password',
  'pin-setup',
  'admin-create',
  'vault-new',
  'vault-edit'
];

// Regex for allowed routes (e.g. overview, mcps, settings:llm, mcps:mcp-123)
export const ROUTE_PATTERN =
  /^(overview|mcps|agents|vault|audit|kanban|settings)(:([a-zA-Z0-9_-]{1,64}))?$/;

// Safe CSS selector: letters, numbers, hyphens, underscores, dots, hashes, colons, brackets, quotes, spaces, asterisks
export const SAFE_SELECTOR_PATTERN = /^[a-zA-Z0-9_\-\.\#\s\:\*\[\]\=\'\"]+$/;

/**
 * Validates a tool call from LLM.
 * Returns { valid: boolean, tool?: { name, arguments }, reason?: string }
 */
export function validateToolCall(call) {
  if (!call || typeof call !== 'object') {
    return { valid: false, reason: 'Tool call phải là một đối tượng' };
  }

  const { name } = call;
  const args = call.arguments && typeof call.arguments === 'object' ? call.arguments : {};

  if (!ALLOWED_CHAT_TOOLS.includes(name)) {
    return { valid: false, reason: `Công cụ không được phép: ${name}` };
  }

  if (name === 'navigate') {
    if (typeof args.route !== 'string' || !args.route.trim()) {
      return { valid: false, reason: 'Tham số route phải là chuỗi không rỗng' };
    }
    const route = args.route.trim();
    if (!ROUTE_PATTERN.test(route)) {
      return { valid: false, reason: `Đường dẫn route không hợp lệ: ${route}` };
    }
    return { valid: true, tool: { name: 'navigate', arguments: { route } } };
  }

  if (name === 'open_modal') {
    if (typeof args.kind !== 'string' || !args.kind.trim()) {
      return { valid: false, reason: 'Tham số kind phải là chuỗi không rỗng' };
    }
    const kind = args.kind.trim();
    if (!ALLOWED_MODAL_KINDS.includes(kind)) {
      return { valid: false, reason: `Loại modal không nằm trong danh sách cho phép: ${kind}` };
    }

    // Safety constraint: explicitly block any action that could be destructive
    if (/^(do-|delete|remove|disconnect|revoke|reveal)/i.test(kind)) {
      return { valid: false, reason: `Chặn thao tác nguy hiểm: ${kind}` };
    }

    const validatedArgs = { kind };
    if (args.id !== undefined && args.id !== null) {
      const id = String(args.id).trim();
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
        return { valid: false, reason: `ID đối tượng không hợp lệ: ${id}` };
      }
      validatedArgs.id = id;
    }
    return { valid: true, tool: { name: 'open_modal', arguments: validatedArgs } };
  }

  if (name === 'highlight') {
    if (typeof args.selector !== 'string' || !args.selector.trim()) {
      return { valid: false, reason: 'Tham số selector phải là chuỗi không rỗng' };
    }
    const selector = args.selector.trim();
    if (selector.length > 120) {
      return { valid: false, reason: 'Selector vượt quá 120 ký tự' };
    }

    // Check for dangerous keywords or tags
    if (/<|>|javascript:|expression\(|url\(|data:/i.test(selector)) {
      return { valid: false, reason: 'Selector chứa ký tự hoặc từ khóa nguy hiểm' };
    }

    if (!SAFE_SELECTOR_PATTERN.test(selector)) {
      return { valid: false, reason: `Selector chứa ký tự không an toàn: ${selector}` };
    }

    // Check balanced brackets and quotes
    const openBrackets = (selector.match(/\[/g) || []).length;
    const closeBrackets = (selector.match(/\]/g) || []).length;
    if (openBrackets !== closeBrackets) {
      return { valid: false, reason: 'Selector có ngoặc vuông không đóng đúng' };
    }

    const singleQuotes = (selector.match(/'/g) || []).length;
    if (singleQuotes % 2 !== 0) {
      return { valid: false, reason: 'Selector có dấu nháy đơn không đóng đúng' };
    }

    const doubleQuotes = (selector.match(/"/g) || []).length;
    if (doubleQuotes % 2 !== 0) {
      return { valid: false, reason: 'Selector có dấu nháy kép không đóng đúng' };
    }

    return { valid: true, tool: { name: 'highlight', arguments: { selector } } };
  }

  return { valid: false, reason: 'Công cụ không được nhận diện' };
}

/**
 * Filter an array of raw tool calls, returning only the validated ones.
 */
export function filterValidToolCalls(calls) {
  if (!Array.isArray(calls)) return [];
  const valid = [];
  for (const call of calls) {
    const res = validateToolCall(call);
    if (res.valid) {
      valid.push(res.tool);
    }
  }
  return valid;
}
