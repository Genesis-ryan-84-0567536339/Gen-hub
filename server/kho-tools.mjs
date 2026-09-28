import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HubError } from './net.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

export const TABLE_PREFIX_MAP = {
  'dự án': 'DA',
  'du an': 'DA',
  'da': 'DA',
  'việc': 'VIEC',
  'viec': 'VIEC',
  'phiên': 'PHIEN',
  'phien': 'PHIEN',
  'quyết định': 'QD',
  'quyet dinh': 'QD',
  'qd': 'QD',
  'bài học': 'BAI',
  'bai hoc': 'BAI',
  'bai': 'BAI',
  'tri thức': 'TT',
  'tri thuc': 'TT',
  'tt': 'TT',
  'tài sản': 'TS',
  'tai san': 'TS',
  'ts': 'TS',
  'chỉ mục khóa': 'KHOA',
  'chi muc khoa': 'KHOA',
  'chỉ mục khoá': 'KHOA',
  'khoa': 'KHOA'
};

export const khoListTool = {
  name: 'kho_list',
  description:
    'Liệt kê danh sách bản ghi trong một bảng của Kho Ryan (vd: Việc, Dự án, Phiên, Quyết định, Bài học, Tri thức, Tài sản, Chỉ mục khóa). Hỗ trợ tìm kiếm từ khóa và phân trang.',
  inputSchema: {
    type: 'object',
    properties: {
      bang: {
        type: 'string',
        description: 'Tên bảng (vd: Việc, Dự án, Phiên, Quyết định, Bài học, Tri thức, Tài sản, Chỉ mục khóa) hoặc mã tiền tố (VIEC, DA, PHIEN, QD, BAI, TT, TS, KHOA)'
      },
      filter: {
        type: 'string',
        description: 'Từ khóa tìm kiếm trong bảng (tùy chọn)'
      },
      limit: {
        type: 'integer',
        description: 'Số lượng bản ghi tối đa (mặc định: 20, tối đa: 100)'
      },
      page: {
        type: 'integer',
        description: 'Số trang (mặc định: 1)'
      }
    },
    required: ['bang'],
    additionalProperties: false
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  published: true,
  permission: { status: 'ok', reason: 'Khả dụng' }
};

export const khoGetTool = {
  name: 'kho_get',
  description:
    'Lấy chi tiết một bản ghi trong Kho Ryan theo mã ID có tiền tố (vd: PHIEN-1, VIEC-12, DA-1, QD-3, BAI-5, TT-1, TS-2, KHOA-4). Trả về toàn bộ các trường của bản ghi.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Mã định danh có tiền tố (ví dụ: PHIEN-1, VIEC-1, DA-2, QD-1, BAI-1, TT-1)'
      }
    },
    required: ['id'],
    additionalProperties: false
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  published: true,
  permission: { status: 'ok', reason: 'Khả dụng' }
};

export const khoCreateTool = {
  name: 'kho_create',
  description:
    'Tạo mới một bản ghi trong một bảng của Kho Ryan. Đặt tên bảng và cung cấp đối tượng dữ liệu trong `fields`.',
  inputSchema: {
    type: 'object',
    properties: {
      bang: {
        type: 'string',
        description: 'Tên bảng (vd: Việc, Dự án, Phiên, Quyết định, Bài học, Tri thức, Tài sản, Chỉ mục khóa) hoặc tiền tố (VIEC, DA, PHIEN, QD, BAI, TT, TS, KHOA)'
      },
      fields: {
        type: 'object',
        description: 'Đối tượng chứa các trường dữ liệu cần tạo (vd: {"Tiêu đề": "Tác vụ mới", "Trạng thái": "Đang làm"}). Trường lựa chọn phải dùng đúng giá trị có sẵn, vd Trạng thái Việc: Chờ | Đang làm | Chờ duyệt | Xong'
      }
    },
    required: ['bang', 'fields'],
    additionalProperties: false
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  published: true,
  permission: { status: 'ok', reason: 'Khả dụng' }
};

export const khoUpdateTool = {
  name: 'kho_update',
  description:
    'Cập nhật các trường dữ liệu của một bản ghi trong Kho Ryan theo mã ID có tiền tố (vd: VIEC-12, DA-1).',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Mã định danh có tiền tố (ví dụ: VIEC-12, PHIEN-1, DA-1)'
      },
      fields: {
        type: 'object',
        description: 'Đối tượng chứa các trường dữ liệu cần cập nhật (vd: {"Trạng thái": "Xong", "Ngày xong": "2026-09-27"})'
      }
    },
    required: ['id', 'fields'],
    additionalProperties: false
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  published: true,
  permission: { status: 'ok', reason: 'Khả dụng' }
};

export const khoSearchTool = {
  name: 'kho_search',
  description:
    'Tìm kiếm thông tin trong Kho Ryan theo từ khóa văn bản. Có thể tìm trong 1 bảng cụ thể hoặc tự động tìm trên tất cả các bảng chính.',
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Từ khóa cần tìm kiếm'
      },
      bang: {
        type: 'string',
        description: 'Tên bảng cần tìm (tùy chọn; nếu để trống sẽ tìm trên 6 bảng: Dự án, Việc, Phiên, Quyết định, Bài học, Tri thức)'
      }
    },
    required: ['text'],
    additionalProperties: false
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  published: true,
  permission: { status: 'ok', reason: 'Khả dụng' }
};

export const khoFindByIdTool = {
  ...khoGetTool,
  name: 'kho_find_by_id',
  description:
    'Tra cứu nhanh bản ghi trong Kho Ryan theo ID tiền tố (alias tương đương kho_get, vd: VIEC-12, PHIEN-1, DA-1).'
};

export const KHO_TOOLS = [
  khoListTool,
  khoGetTool,
  khoCreateTool,
  khoUpdateTool,
  khoSearchTool,
  khoFindByIdTool
];

let memoryTableIds = null;

export function loadTableIds(customPath) {
  if (memoryTableIds === false) return null;
  if (memoryTableIds !== null) return memoryTableIds;
  const filePath = customPath || process.env.KHO_TABLE_IDS_PATH || '/data/kho_table_ids.json';
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export function setMemoryTableIds(mapping) {
  memoryTableIds = mapping;
}

export function resolveRestBase(context) {
  if (context?.restUrl) return context.restUrl.replace(/\/+$/, '');
  if (process.env.BASEROW_REST_URL) return process.env.BASEROW_REST_URL.replace(/\/+$/, '');
  if (context?.url) {
    try {
      const u = new URL(context.url);
      return `${u.protocol}//${u.host}`;
    } catch {
      // ignore
    }
  }
  return 'http://kho:80';
}


function extractData(res) {
  if (res?.json !== undefined && res?.json !== null) return res.json;
  if (typeof res?.body === 'string') {
    try { return JSON.parse(res.body); } catch {}
  }
  if (res?.body && typeof res.body === 'object') return res.body;
  if (typeof res?.text === 'string') {
    try { return JSON.parse(res.text); } catch {}
    if (res.text.trim()) return { raw: res.text.trim() };
  }
  return {};
}

function isHttpError(res, data) {
  if (res?.status && (res.status < 200 || res.status >= 300)) return true;
  if (data?.error) return true;
  return false;
}

function buildHeaders(token) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(token ? { Authorization: token.startsWith('JWT ') || token.startsWith('Token ') ? token : `Token ${token}` } : {})
  };
}

export function resolveTableInfo(bangOrPrefix, tableIds) {
  const raw = String(bangOrPrefix || '').trim().toLowerCase();
  const prefix = TABLE_PREFIX_MAP[raw] || (PREFIX_TABLE_MAP[raw.toUpperCase()] ? raw.toUpperCase() : null);
  if (!prefix) {
    const validNames = Object.values(PREFIX_TABLE_MAP).join(', ');
    throw new HubError(
      `Tiền tố '${bangOrPrefix}' không thuộc 8 bảng của Kho Ryan. Các bảng hợp lệ: ${validNames}`,
      400
    );
  }
  const map = tableIds !== undefined ? tableIds : loadTableIds();
  if (!map || typeof map !== 'object' || Object.keys(map).length === 0) {
    throw new HubError(
      'Chưa có dữ liệu ánh xạ bảng Kho Ryan (thiếu table_ids.json). Vui lòng chạy lệnh "kho-schema" để đồng bộ trước khi thao tác.',
      503
    );
  }
  const tableId = map[prefix];
  if (!tableId) {
    throw new HubError(
      `Chưa tìm thấy ID bảng cho '${PREFIX_TABLE_MAP[prefix]}'. Vui lòng chạy lệnh 'kho-schema' để đồng bộ bảng.`,
      404
    );
  }
  return { prefix, tableName: PREFIX_TABLE_MAP[prefix], tableId };
}

export async function khoList(args, { url, restUrl, token, tableIds, allowPrivate, request }) {
  const { bang, filter, limit = 20, page = 1 } = args || {};
  const { prefix, tableName, tableId } = resolveTableInfo(bang, tableIds);
  const restBase = resolveRestBase({ restUrl, url });
  const size = Math.min(Math.max(1, parseInt(limit, 10) || 20), 100);
  const p = Math.max(1, parseInt(page, 10) || 1);
  let queryUrl = `${restBase}/api/database/rows/table/${tableId}/?user_field_names=true&page=${p}&size=${size}`;
  if (filter && String(filter).trim()) {
    queryUrl += `&search=${encodeURIComponent(String(filter).trim())}`;
  }
  const headers = buildHeaders(token);
  try {
    const res = await request(queryUrl, { headers, method: 'GET', allowPrivate });
    const data = extractData(res);
    if (isHttpError(res, data)) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              typeof data === 'object' && data !== null && !Array.isArray(data)
                ? {
                    thong_bao: `Lỗi đọc danh sách bảng '${tableName}' từ Kho`,
                    ...data
                  }
                : {
                    thong_bao: `Lỗi đọc danh sách bảng '${tableName}' từ Kho`,
                    chi_tiet: data
                  },
              null,
              2
            )
          }
        ],
        isError: true
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            bang: tableName,
            tien_to: prefix,
            tong_so: data.count,
            trang: p,
            gioi_han: size,
            danh_sach: data.results || []
          }, null, 2)
        }
      ],
      isError: false
    };
  } catch (err) {
    throw new HubError(`Lỗi đọc danh sách bảng '${tableName}' từ Kho: ${err.message}`, err.status || 502);
  }
}

export async function khoGet(args, { url, restUrl, token, tableIds, allowPrivate, request }) {
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
  const { tableName, tableId } = resolveTableInfo(prefix, tableIds);

  const restBase = resolveRestBase({ restUrl, url });
  const rowUrl = `${restBase}/api/database/rows/table/${tableId}/${rowId}/?user_field_names=true`;
  const headers = buildHeaders(token);

  try {
    const res = await request(rowUrl, { headers, method: 'GET', allowPrivate });
    const rowData = extractData(res);
    if (isHttpError(res, rowData) || !rowData?.id) {
      if (res?.status === 404 || rowData?.error === 'ERROR_ROW_DOES_NOT_EXIST') {
        throw new HubError(`Không tìm thấy bản ghi ${rawId} trong bảng '${tableName}'`, 404);
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              typeof rowData === 'object' && rowData !== null && !Array.isArray(rowData)
                ? {
                    thong_bao: `Lỗi đọc bản ghi ${rawId} từ Kho`,
                    ...rowData
                  }
                : {
                    thong_bao: `Lỗi đọc bản ghi ${rawId} từ Kho`,
                    chi_tiet: rowData
                  },
              null,
              2
            )
          }
        ],
        isError: true
      };
    }
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

export async function khoCreate(args, { url, restUrl, token, tableIds, allowPrivate, request }) {
  const { bang, fields } = args || {};
  if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) {
    throw new HubError('Cần cung cấp dữ liệu các trường cần tạo trong `fields`', 400);
  }
  const { prefix, tableName, tableId } = resolveTableInfo(bang, tableIds);
  const restBase = resolveRestBase({ restUrl, url });
  const rowUrl = `${restBase}/api/database/rows/table/${tableId}/?user_field_names=true`;
  const headers = buildHeaders(token);

  try {
    const res = await request(rowUrl, {
      headers,
      method: 'POST',
      body: JSON.stringify(fields),
      allowPrivate
    });
    const createdRow = extractData(res);
    if (isHttpError(res, createdRow) || !createdRow?.id) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              typeof createdRow === 'object' && createdRow !== null && !Array.isArray(createdRow)
                ? {
                    thong_bao: `Lỗi tạo bản ghi trong bảng '${tableName}' của Kho`,
                    ...createdRow
                  }
                : {
                    thong_bao: `Lỗi tạo bản ghi trong bảng '${tableName}' của Kho`,
                    chi_tiet: createdRow
                  },
              null,
              2
            )
          }
        ],
        isError: true
      };
    }
    const assignedId = createdRow['Mã ID'] || `${prefix}-${createdRow.id}`;
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            thong_bao: `Đã tạo thành công bản ghi mới trong bảng '${tableName}'`,
            id: assignedId,
            table: tableName,
            data: createdRow
          }, null, 2)
        }
      ],
      isError: false
    };
  } catch (err) {
    throw new HubError(`Lỗi tạo bản ghi trong bảng '${tableName}' của Kho: ${err.message}`, err.status || 502);
  }
}

export async function khoUpdate(args, { url, restUrl, token, tableIds, allowPrivate, request }) {
  const rawId = String(args?.id || '').trim();
  const { fields } = args || {};
  if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) {
    throw new HubError('Cần cung cấp dữ liệu các trường cần cập nhật trong `fields`', 400);
  }
  const match = /^([A-Za-z]+)-(\d+)$/.exec(rawId);
  if (!match) {
    throw new HubError(
      `Mã ID không hợp lệ: '${rawId}'. Định dạng hợp lệ phải có tiền tố và số (vd: VIEC-12, QD-3, DA-1)`,
      400
    );
  }
  const prefix = match[1].toUpperCase();
  const rowId = parseInt(match[2], 10);
  const { tableName, tableId } = resolveTableInfo(prefix, tableIds);

  const restBase = resolveRestBase({ restUrl, url });
  const rowUrl = `${restBase}/api/database/rows/table/${tableId}/${rowId}/?user_field_names=true`;
  const headers = buildHeaders(token);

  try {
    const res = await request(rowUrl, {
      headers,
      method: 'PATCH',
      body: JSON.stringify(fields),
      allowPrivate
    });
    const updatedRow = extractData(res);
    if (isHttpError(res, updatedRow) || !updatedRow?.id) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              typeof updatedRow === 'object' && updatedRow !== null && !Array.isArray(updatedRow)
                ? {
                    thong_bao: `Lỗi cập nhật bản ghi ${rawId} trong bảng '${tableName}' của Kho`,
                    ...updatedRow
                  }
                : {
                    thong_bao: `Lỗi cập nhật bản ghi ${rawId} trong bảng '${tableName}' của Kho`,
                    chi_tiet: updatedRow
                  },
              null,
              2
            )
          }
        ],
        isError: true
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            thong_bao: `Đã cập nhật bản ghi ${rawId} trong bảng '${tableName}'`,
            id: rawId,
            table: tableName,
            data: updatedRow
          }, null, 2)
        }
      ],
      isError: false
    };
  } catch (err) {
    if (err.status === 404) {
      throw new HubError(`Không tìm thấy bản ghi ${rawId} trong bảng '${tableName}'`, 404);
    }
    throw new HubError(`Lỗi cập nhật bản ghi ${rawId} trong Kho: ${err.message}`, 502);
  }
}

export async function khoSearch(args, { url, restUrl, token, tableIds, allowPrivate, request }) {
  const text = String(args?.text || '').trim();
  if (!text) {
    throw new HubError('Cần cung cấp từ khóa tìm kiếm trong `text`', 400);
  }
  const map = tableIds !== undefined ? tableIds : loadTableIds();
  if (!map || typeof map !== 'object' || Object.keys(map).length === 0) {
    throw new HubError(
      'Chưa có dữ liệu ánh xạ bảng Kho Ryan (thiếu table_ids.json). Vui lòng chạy lệnh "kho-schema" để đồng bộ trước khi tìm kiếm.',
      503
    );
  }
  const restBase = resolveRestBase({ restUrl, url });
  const headers = buildHeaders(token);

  const targets = args?.bang
    ? [resolveTableInfo(args.bang, map)]
    : ['Dự án', 'Việc', 'Phiên', 'Quyết định', 'Bài học', 'Tri thức'].map(t => resolveTableInfo(t, map));

  const allMatches = [];
  for (const { prefix, tableName, tableId } of targets) {
    const queryUrl = `${restBase}/api/database/rows/table/${tableId}/?user_field_names=true&search=${encodeURIComponent(text)}&size=10`;
    try {
      const res = await request(queryUrl, { headers, method: 'GET', allowPrivate });
      const data = extractData(res);
      if (isHttpError(res, data)) {
        continue;
      }
      const rows = data.results || [];
      for (const r of rows) {
        allMatches.push({
          id: r['Mã ID'] || `${prefix}-${r.id}`,
          bang: tableName,
          data: r
        });
      }
    } catch {
      // skip errors on individual tables
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          tu_khoa: text,
          so_ket_qua: allMatches.length,
          ket_qua: allMatches
        }, null, 2)
      }
    ],
    isError: false
  };
}

export const khoFindById = khoGet;
