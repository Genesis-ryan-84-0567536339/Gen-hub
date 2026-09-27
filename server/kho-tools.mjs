import { HubError } from './net.mjs';

export const PREFIX_TABLE_MAP = {
  DA: 'Dự án',
  VIEC: 'Việc',
  PHIEN: 'Phiên',
  QD: 'Quyết định',
  BAI: 'Bài học',
  TT: 'Tri thức',
  TS: 'Tài sản',
  KHOA: 'Chỉ mục khóa'
};

export const khoFindByIdTool = {
  name: 'kho_find_by_id',
  description:
    'Tra cứu nhanh bản ghi trong Kho Ryan theo ID tiền tố (vd: VIEC-12, DA-1, PHIEN-2, QD-3, BAI-5, TT-1, TS-2, KHOA-4). Trả về đầy đủ các trường của bản ghi.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Mã định danh có tiền tố (ví dụ: VIEC-1, DA-2, PHIEN-1, QD-1, BAI-1, TT-1, TS-1, KHOA-1)'
      }
    },
    required: ['id'],
    additionalProperties: false
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  published: true,
  permission: { status: 'ok', reason: 'Khả dụng' }
};

const tableCache = new Map(); // baseUrl -> { timestamp, tablesByName: Map(name -> tableId) }

export async function resolveBaserowTable(baseUrl, tableName, { token, allowPrivate, request }) {
  const cached = tableCache.get(baseUrl);
  const now = Date.now();
  if (cached && now - cached.timestamp < 60000 && cached.tablesByName.has(tableName)) {
    return cached.tablesByName.get(tableName);
  }

  // Fetch applications to find Baserow database
  const headers = {
    Accept: 'application/json',
    ...(token ? { Authorization: token.startsWith('JWT ') || token.startsWith('Token ') ? token : `Token ${token}` } : {})
  };

  const appsUrl = `${baseUrl.replace(/\/api\/.*$/, '')}/api/applications/`;
  let apps;
  try {
    const res = await request(appsUrl, { headers, method: 'GET', allowPrivate });
    apps = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
  } catch (err) {
    throw new HubError(`Không kết nối được tới Baserow API để tra cứu bảng: ${err.message}`, 502);
  }

  if (!Array.isArray(apps)) {
    throw new HubError('Phản hồi danh sách ứng dụng Baserow không hợp lệ', 502);
  }

  const database = apps.find(a => a.type === 'database') || apps[0];
  if (!database) {
    throw new HubError('Không tìm thấy Database nào trong Baserow workspace', 404);
  }

  const tablesUrl = `${baseUrl.replace(/\/api\/.*$/, '')}/api/database/tables/database/${database.id}/`;
  const tablesRes = await request(tablesUrl, { headers, method: 'GET', allowPrivate });
  const tables = typeof tablesRes.body === 'string' ? JSON.parse(tablesRes.body) : tablesRes.body;

  if (!Array.isArray(tables)) {
    throw new HubError('Phản hồi danh sách bảng Baserow không hợp lệ', 502);
  }

  const tablesByName = new Map();
  for (const t of tables) {
    tablesByName.set(t.name, t.id);
  }
  tableCache.set(baseUrl, { timestamp: now, tablesByName });

  const tableId = tablesByName.get(tableName);
  if (!tableId) {
    throw new HubError(`Không tìm thấy bảng '${tableName}' trong Kho Ryan`, 404);
  }
  return tableId;
}

export async function khoFindById(args, { url, token, allowPrivate, request }) {
  const rawId = String(args?.id || '').trim();
  const match = /^([A-Za-z]+)-(\d+)$/.exec(rawId);
  if (!match) {
    throw new HubError(
      `Mã ID không hợp lệ: '${rawId}'. Định dạng hợp lệ phải có tiền tố và số (vd: VIEC-12, QD-3, DA-1)`,
      400
    );
  }

  const prefix = match[1].toUpperCase();
  const rowId = parseInt(match[2], 10);
  const tableName = PREFIX_TABLE_MAP[prefix];
  if (!tableName) {
    const validPrefixes = Object.keys(PREFIX_TABLE_MAP).join(', ');
    throw new HubError(
      `Tiền tố '${prefix}' không thuộc 8 bảng của Kho Ryan. Các tiền tố hợp lệ: ${validPrefixes}`,
      400
    );
  }

  const tableId = await resolveBaserowTable(url, tableName, { token, allowPrivate, request });
  const baseUrl = url.replace(/\/api\/.*$/, '');
  const rowUrl = `${baseUrl}/api/database/rows/table/${tableId}/${rowId}/?user_field_names=true`;

  const headers = {
    Accept: 'application/json',
    ...(token ? { Authorization: token.startsWith('JWT ') || token.startsWith('Token ') ? token : `Token ${token}` } : {})
  };

  try {
    const res = await request(rowUrl, { headers, method: 'GET', allowPrivate });
    const rowData = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            id: rawId,
            table: tableName,
            data: rowData
          }, null, 2)
        }
      ],
      isError: false
    };
  } catch (err) {
    if (err.status === 404) {
      throw new HubError(`Không tìm thấy bản ghi ${rawId} trong bảng '${tableName}'`, 404);
    }
    throw new HubError(`Lỗi đọc bản ghi ${rawId} từ Kho: ${err.message}`, 502);
  }
}
