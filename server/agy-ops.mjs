import { execFile as childExecFile } from 'node:child_process';
import { writeFile as fsWriteFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HubError } from './net.mjs';
import { uniqueId } from './store.mjs';

export const AGY_SESSIONS = Object.freeze({
  'agy-colamacbook': { kind: 'agy', label: 'Cola MacBook' },
  'agy-colabotmac': { kind: 'agy', label: 'Cola Bot Mac' },
  'agy-genesiscorpos': { kind: 'agy', label: 'Genesis Corpos' },
  'codex-astra': { kind: 'codex', label: 'Codex Astra' }
});

export const AGY_TASK_STATUSES = Object.freeze([
  'queued',
  'dispatched',
  'in_progress',
  'done',
  'failed'
]);

export const AGY_OPS_BOOTSTRAP_INSTRUCTIONS =
  'Gen-hub có connector `agy-ops` để giao việc và xem trạng thái 3 phiên Antigravity CLI + 1 phiên Codex CLI trên máy Ryan. Mặc định dùng `queue_task`, rồi chỉ dùng `set_task_status` sau khi đã tự kiểm tra trạng thái thực tế; không gọi `dispatch` trực tiếp trừ việc gấp, vì hàng đợi giữ đúng thứ tự và tránh chồng hai việc lên một session.';

const stringSchema = (description, maximum = 16000) => ({
  type: 'string',
  description,
  minLength: 1,
  maxLength: maximum
});

const localTool = (name, description, properties = {}, required = [], write = false, scopes = []) => ({
  name,
  description,
  inputSchema: { type: 'object', properties, required, additionalProperties: false },
  annotations: { readOnlyHint: !write, destructiveHint: write, openWorldHint: true },
  published: !write,
  scopes
});

export function agyOpsTools(tool = localTool) {
  const session = {
    ...stringSchema('Tên phiên local được phép'),
    enum: Object.keys(AGY_SESSIONS)
  };
  const status = {
    type: 'string',
    description: 'Trạng thái task',
    enum: AGY_TASK_STATUSES
  };
  return [
    tool('list_sessions', 'Liệt kê trạng thái 4 phiên Agy/Codex local.'),
    tool('get_status', 'Đọc trạng thái một phiên local.', { session }, ['session']),
    tool(
      'dispatch',
      'Giao brief ngay cho một phiên local; ưu tiên queue_task trừ việc khẩn.',
      { session, text: stringSchema('Nội dung brief', 16000) },
      ['session', 'text'],
      true
    ),
    tool(
      'queue_task',
      'Thêm task vào hàng đợi tuần tự của Agy Ops.',
      {
        session,
        title: stringSchema('Tiêu đề task', 200),
        brief: stringSchema('Brief task', 16000),
        order: {
          type: 'integer',
          description: 'Thứ tự checklist; mặc định nối cuối hàng đợi.',
          minimum: 1,
          maximum: 1_000_000_000
        }
      },
      ['session', 'title', 'brief'],
      true
    ),
    tool(
      'list_tasks',
      'Liệt kê checklist Agy Ops theo thứ tự.',
      { session, status },
      []
    ),
    tool(
      'set_task_status',
      'Xác nhận trạng thái thực tế của một task.',
      {
        id: stringSchema('ID task', 128),
        status,
        note: { type: 'string', description: 'Ghi chú kết quả', maxLength: 2000 }
      },
      ['id', 'status'],
      true
    ),
    tool(
      'delete_task',
      'Xóa một task khỏi checklist Agy Ops.',
      { id: stringSchema('ID task', 128) },
      ['id'],
      true
    ),
    tool('auto_dispatch_tick', 'Chạy ngay một nhịp điều phối hàng đợi.', {}, [], true)
  ];
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const execute = (file, args) =>
  new Promise((resolve, reject) => {
    childExecFile(file, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
      } else resolve({ stdout, stderr });
    });
  });

export function assertSession(session) {
  if (typeof session !== 'string' || !Object.hasOwn(AGY_SESSIONS, session)) {
    throw new HubError('Phiên Agy Ops không hợp lệ');
  }
  return AGY_SESSIONS[session];
}

function stringArg(value, label, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new HubError(`${label} cần 1–${maximum} ký tự`);
  }
  return value.trim();
}

function optionalString(value, label, maximum) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > maximum) {
    throw new HubError(`${label} tối đa ${maximum} ký tự`);
  }
  return value.trim();
}

function taskOrder(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000_000) {
    throw new HubError('Thứ tự task cần là số nguyên từ 1 đến 1000000000');
  }
  return value;
}

function tailLines(text, count) {
  return String(text || '')
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.trim())
    .slice(-count);
}

export function createAgyOps({ execFile = execute, writeFile = fsWriteFile, sleep = wait } = {}) {
  async function tmux(args) {
    try {
      return await execFile('tmux', args);
    } catch (error) {
      if (error instanceof HubError) throw error;
      const detail = String(error?.stderr || '').trim().slice(0, 300);
      throw new HubError(detail ? `tmux: ${detail}` : 'Không thể gọi tmux', 502);
    }
  }

  async function sessionAlive(session) {
    assertSession(session);
    try {
      await tmux(['has-session', '-t', session]);
      return true;
    } catch {
      return false;
    }
  }

  async function paneContent(session, lines = 200) {
    assertSession(session);
    if (!Number.isInteger(lines) || lines < 1 || lines > 2000) {
      throw new HubError('Số dòng pane cần từ 1 đến 2000');
    }
    const { stdout = '' } = await tmux([
      'capture-pane',
      '-p',
      '-t',
      session,
      '-S',
      `-${lines}`
    ]);
    return String(stdout);
  }

  async function sessionStatus(session) {
    const config = assertSession(session);
    if (!(await sessionAlive(session))) return { session, alive: false, idle: false, snippet: '' };
    const first = await paneContent(session);
    await sleep(1200);
    const second = await paneContent(session);
    const lines = tailLines(second, 8);
    const last = lines.at(-1) || '';
    const unchanged = first === second;
    const idle = unchanged && (config.kind !== 'codex' || /Ask Codex to do anything/.test(last));
    return { session, alive: true, idle, snippet: lines.join('\n') };
  }

  async function dispatch(session, rawText) {
    const config = assertSession(session);
    const text = stringArg(rawText, 'Nội dung giao việc', 16000);
    if (!(await sessionAlive(session))) throw new HubError(`Phiên ${session} không hoạt động`, 409);

    let submitted = text;
    if (config.kind === 'codex' && (text.length > 400 || /\n\s*\n/.test(text))) {
      const { stdout = '' } = await tmux([
        'display-message',
        '-p',
        '-t',
        session,
        '#{pane_current_path}'
      ]);
      const cwd = String(stdout).trim();
      if (!cwd.startsWith('/')) throw new HubError('Không xác định được thư mục hiện tại của Codex');
      await writeFile(join(cwd, 'DISPATCH_BRIEF.md'), text, { encoding: 'utf8', mode: 0o600 });
      submitted = 'Doc ky file DISPATCH_BRIEF.md trong thu muc hien tai roi bat dau lam theo do.';
    }

    // `-l` makes the brief literal input instead of allowing tmux to interpret
    // values such as `C-c` or option-looking text as key names/options.
    await tmux(['send-keys', '-t', session, '-l', '--', submitted]);
    await tmux(['send-keys', '-t', session, 'Enter']);
    if (config.kind === 'agy') {
      await sleep(400);
      await tmux(['send-keys', '-t', session, 'Enter']);
    }
    return { session, dispatched: true };
  }

  function queueTask(store, input = {}) {
    const session = input.session;
    assertSession(session);
    const title = stringArg(input.title, 'Tiêu đề task', 200);
    const brief = stringArg(input.brief, 'Brief task', 16000);
    const existing = store.list('agy_task');
    const order =
      input.order === undefined
        ? Math.max(0, ...existing.map(task => Number.isSafeInteger(task.order) ? task.order : 0)) + 1
        : taskOrder(input.order);
    const created = new Date().toISOString();
    const task = {
      id: uniqueId(store, 'agy_task', 'task'),
      session,
      title,
      brief,
      status: 'queued',
      order,
      created,
      dispatched_at: null,
      done_at: null,
      note: ''
    };
    store.put('agy_task', task.id, task);
    return task;
  }

  function listTasks(store, filters = {}) {
    if (filters.session !== undefined) assertSession(filters.session);
    if (filters.status !== undefined && !AGY_TASK_STATUSES.includes(filters.status)) {
      throw new HubError('Trạng thái task không hợp lệ');
    }
    return store
      .list('agy_task')
      .filter(task => filters.session === undefined || task.session === filters.session)
      .filter(task => filters.status === undefined || task.status === filters.status)
      .sort((a, b) => a.order - b.order || a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
  }

  function setTaskStatus(store, id, status, rawNote) {
    const taskId = stringArg(id, 'ID task', 128);
    if (!AGY_TASK_STATUSES.includes(status)) throw new HubError('Trạng thái task không hợp lệ');
    const task = store.get('agy_task', taskId);
    if (!task) throw new HubError('Không tìm thấy task Agy Ops', 404);
    const now = new Date().toISOString();
    task.status = status;
    if (rawNote !== undefined) task.note = optionalString(rawNote, 'Ghi chú', 2000);
    if (['dispatched', 'in_progress'].includes(status) && !task.dispatched_at) {
      task.dispatched_at = now;
    }
    if (status === 'done') task.done_at = now;
    else if (!['failed'].includes(status)) task.done_at = null;
    store.put('agy_task', task.id, task);
    return task;
  }

  function deleteTask(store, id) {
    const taskId = stringArg(id, 'ID task', 128);
    if (!store.get('agy_task', taskId)) throw new HubError('Không tìm thấy task Agy Ops', 404);
    store.del('agy_task', taskId);
    return { id: taskId, deleted: true };
  }

  async function autoDispatchTick(store) {
    const results = [];
    for (const session of Object.keys(AGY_SESSIONS)) {
      const tasks = listTasks(store, { session });
      if (tasks.some(task => ['dispatched', 'in_progress'].includes(task.status))) {
        results.push({ session, status: 'busy' });
        continue;
      }
      const task = tasks.find(task => task.status === 'queued');
      if (!task) {
        results.push({ session, status: 'empty' });
        continue;
      }
      try {
        const current = await sessionStatus(session);
        if (!current.alive || !current.idle) {
          results.push({ session, task: task.id, status: current.alive ? 'not_idle' : 'offline' });
          continue;
        }
        await dispatch(session, task.brief);
        setTaskStatus(store, task.id, 'dispatched');
        results.push({ session, task: task.id, status: 'dispatched' });
      } catch (error) {
        const reason = String(error?.message || 'Không thể giao task').slice(0, 2000);
        setTaskStatus(store, task.id, 'failed', reason);
        results.push({
          session,
          task: task.id,
          status: 'failed',
          error: error?.message || 'Lỗi không xác định'
        });
      }
    }
    return results;
  }

  async function agyOpsCall(toolName, args = {}, store) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw new HubError('Tham số Agy Ops không hợp lệ');
    }
    if (toolName === 'list_sessions') {
      return await Promise.all(Object.keys(AGY_SESSIONS).map(sessionStatus));
    }
    if (toolName === 'get_status') return await sessionStatus(args.session);
    if (toolName === 'dispatch') return await dispatch(args.session, args.text);
    if (toolName === 'queue_task') return queueTask(store, args);
    if (toolName === 'list_tasks') return listTasks(store, args);
    if (toolName === 'set_task_status') return setTaskStatus(store, args.id, args.status, args.note);
    if (toolName === 'delete_task') return deleteTask(store, args.id);
    if (toolName === 'auto_dispatch_tick') return await autoDispatchTick(store);
    throw new HubError('Tool Agy Ops không hỗ trợ', 404);
  }

  return {
    sessionAlive,
    paneContent,
    sessionStatus,
    dispatch,
    queueTask,
    listTasks,
    setTaskStatus,
    deleteTask,
    autoDispatchTick,
    agyOpsCall
  };
}

const defaultAgyOps = createAgyOps();
export const sessionAlive = defaultAgyOps.sessionAlive;
export const paneContent = defaultAgyOps.paneContent;
export const sessionStatus = defaultAgyOps.sessionStatus;
export const dispatch = defaultAgyOps.dispatch;
export const queueTask = defaultAgyOps.queueTask;
export const listTasks = defaultAgyOps.listTasks;
export const setTaskStatus = defaultAgyOps.setTaskStatus;
export const deleteTask = defaultAgyOps.deleteTask;
export const autoDispatchTick = defaultAgyOps.autoDispatchTick;
export const agyOpsCall = defaultAgyOps.agyOpsCall;
