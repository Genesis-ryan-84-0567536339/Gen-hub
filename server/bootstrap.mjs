import { id } from './store.mjs';
import { HubError } from './net.mjs';
import { unwrap } from './connector-envelope.mjs';

const MAX_GROUPS = 50;
const MAX_STEPS_PER_GROUP = 50;
const MAX_TITLE = 200;
const MAX_CONTENT = 4000;

function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new HubError(`${label} cần 1–${max} ký tự`);
  return value.trim();
}

function normalizeStep(step) {
  if (!step || typeof step !== 'object') throw new HubError('Bước không hợp lệ');
  return {
    id: typeof step.id === 'string' && step.id ? step.id : id('step'),
    title: text(step.title, MAX_TITLE, 'Tiêu đề bước'),
    content: text(step.content, MAX_CONTENT, 'Nội dung bước')
  };
}

function normalizeGroup(group) {
  if (!group || typeof group !== 'object') throw new HubError('Nhóm không hợp lệ');
  if (!Array.isArray(group.steps) || group.steps.length > MAX_STEPS_PER_GROUP)
    throw new HubError(`Mỗi nhóm tối đa ${MAX_STEPS_PER_GROUP} bước`);
  return {
    id: typeof group.id === 'string' && group.id ? group.id : id('grp'),
    title: text(group.title, MAX_TITLE, 'Tiêu đề nhóm'),
    steps: group.steps.map(normalizeStep)
  };
}

// Áp dụng lúc đọc (giống DEFAULT_SETTINGS/normalizeSettings) — chưa ai lưu gì
// thì agent vẫn nhận được bộ nhắc nhở mặc định này, không phải rỗng.
export const DEFAULT_BOOTSTRAP_GROUPS = [
  {
    id: 'grp-default1',
    title: 'Kết nối nguồn chuẩn',
    steps: [
      {
        id: 'step-default1',
        title: 'Đọc Brain trước',
        content:
          'Trước khi bắt đầu việc, đọc BOOTSTRAP.md của repo ' +
          'Genesis-ryan-84-0567536339/Brain để lấy quy tắc dùng chung toàn hệ sinh thái Genesis.'
      },
      {
        id: 'step-default2',
        title: 'Đọc quy trình riêng của repo',
        content:
          'Nếu việc thuộc 1 repo cụ thể, đọc thêm file quy trình riêng của repo đó ' +
          '(vd docs/TEAM_WORKFLOW.md của Gen-hub) trước khi thao tác.'
      }
    ]
  },
  {
    id: 'grp-default2',
    title: 'Quy trình Issue → Branch → PR',
    steps: [
      {
        id: 'step-default3',
        title: 'Tạo Issue trước khi làm',
        content:
          'Luôn tạo 1 Issue mô tả việc định làm trước khi bắt đầu — kể cả việc còn đang ' +
          'brainstorm/chưa rõ hướng cũng tạo Issue để ghi lại, không chỉ việc đã chốt.'
      },
      {
        id: 'step-default4',
        title: 'Làm trên branch riêng',
        content: 'Branch riêng cho PR đó là sổ tay tạm để code/làm việc — chưa phải chính thức.'
      },
      {
        id: 'step-default5',
        title: 'Chỉ merge sau khi có xác nhận',
        content:
          'Mở PR, chờ có label xác nhận từ người ra lệnh (label "Đã xác nhận") — chỉ merge vào ' +
          'main sau khi có xác nhận đó, không tự merge khi chưa có bằng chứng chấp nhận kết quả.'
      }
    ]
  },
  {
    id: 'grp-default3',
    title: 'Nguyên tắc SSOT',
    steps: [
      {
        id: 'step-default6',
        title: 'Một chủ đề, một tài liệu',
        content:
          'Mỗi chủ đề chỉ có đúng 1 tài liệu chuẩn, luôn cập nhật tại chỗ, không tạo bản sao ở ' +
          'nơi khác. Skill/instruction mới cũng hình thành dần qua đúng quy trình Issue→branch→' +
          'PR→xác nhận→merge này, không phải quy trình ghi riêng nào khác.'
      }
    ]
  },
  {
    id: 'grp-default4',
    title: 'Phản hồi',
    steps: [
      {
        id: 'step-default7',
        title: 'Góp ý qua comment',
        content:
          'Phát hiện bất cập trong lúc làm việc thì comment trực tiếp trên Issue/PR liên quan, ' +
          'như 1 lời nhắc tiện lợi cho người/agent sau.'
      }
    ]
  }
];

const BRAIN_SEED = name => [
  [
    'README.md',
    `# ${name}\n\n${name} là trí nhớ chung: quy tắc, skill và tài liệu chuẩn dùng lại qua nhiều ` +
      `dự án. Đọc \`BOOTSTRAP.md\` trước khi thao tác.\n`
  ],
  [
    'BOOTSTRAP.md',
    `# Bootstrap\n\n1. Đọc \`skills/index.yaml\` trước khi làm việc.\n` +
      `2. Mỗi chủ đề chỉ có đúng 1 tài liệu chuẩn — luôn cập nhật tại chỗ, không tạo bản sao.\n` +
      `3. Việc mới: tạo Issue trước, làm trên branch riêng, mở PR, chờ xác nhận rồi mới merge.\n`
  ],
  [
    'skills/index.yaml',
    `phien_ban_schema: "1.0"\n` +
      `mo_ta: "Registry rỗng — thêm category khi có skill dùng chung đầu tiên."\n` +
      `categories: []\n`
  ]
];

// create_repository trả shape khác nhau tuỳ provider: 'github' (REST thô) trả
// đủ object repo GitHub thật (owner.login, full_name, html_url); 'github-mcp'
// (remote MCP chính thức) chỉ trả {id, url} — phải suy owner/tên repo từ URL.
function normalizeRepo(data, fallbackName) {
  const url = data?.html_url || data?.url;
  if (!url) throw new HubError('Không xác định được URL repo vừa tạo.');
  const match = url.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/?$/);
  const owner = data?.owner?.login || match?.[1];
  const name = data?.name || match?.[2] || fallbackName;
  if (!owner) throw new HubError('Không xác định được chủ sở hữu repo vừa tạo.');
  return { owner, name, url, full_name: data?.full_name || `${owner}/${name}` };
}

export function bootstrapService(store, connectors) {
  async function createBrainRepo({ name, org, description } = {}) {
    const repoName = text(name || 'Brain', 100, 'Tên repo');
    const m = store
      .list('mcp')
      .find(x => (x.provider === 'github' || x.provider === 'github-mcp') && x.on && x.status === 'connected');
    if (!m)
      throw new HubError(
        'Cần kết nối GitHub (connector "GitHub", đủ quyền repo) ở trang Connectors trước khi tạo Brain.'
      );
    const repo = normalizeRepo(
      unwrap(
        await connectors.call(m, 'create_repository', {
          name: repoName,
          org: org || undefined,
          description:
            description || 'Trí nhớ chung — SSOT cho hệ sinh thái, tạo bởi Gen-hub Bootstrap.'
        }),
        'Tạo repo'
      ),
      repoName
    );
    const owner = repo.owner;
    for (const [path, content] of BRAIN_SEED(repoName))
      unwrap(
        await connectors.call(m, 'create_or_update_file', {
          owner,
          repo: repo.name,
          path,
          content,
          message: `chore: seed ${path}`
        }),
        `Ghi file ${path}`
      );
    return { url: repo.url, full_name: repo.full_name };
  }


  function get() {
    const stored = store.get('bootstrap', 'main');
    if (stored) return stored;
    return { groups: DEFAULT_BOOTSTRAP_GROUPS, updated: null };
  }

  function update(groups, actor) {
    if (!Array.isArray(groups) || groups.length > MAX_GROUPS)
      throw new HubError(`Tối đa ${MAX_GROUPS} nhóm`);
    const record = { groups: groups.map(normalizeGroup), updated: new Date().toISOString() };
    store.put('bootstrap', 'main', record);
    store.audit(actor, 'hub', 'bootstrap.update', 'success', { groupCount: record.groups.length }, {});
    return record;
  }

  function render() {
    const { groups } = get();
    if (!groups.length) return '';
    return groups
      .map(
        (g, gi) =>
          `${gi + 1}. ${g.title}\n` +
          g.steps.map((s, si) => `   ${gi + 1}.${si + 1}. ${s.title}: ${s.content}`).join('\n')
      )
      .join('\n\n');
  }

  return { get, update, render, createBrainRepo };
}
