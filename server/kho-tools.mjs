import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HubError } from './net.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_TABLE_IDS_PATH = path.resolve(__dirname, '../kho/table_ids.json');

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

let memoryTableIds = null;

export function loadTableIds(customPath) {
  if (memoryTableIds) return memoryTableIds;
  const filePath = customPath || process.env.KHO_TABLE_IDS_PATH || DEFAULT_TABLE_IDS_PATH;
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch {
    // ignore
  }
  return {
    DA: 1,
    VIEC: 2,
    PHIEN: 3,
    QD: 4,
    BAI: 5,
    TT: 6,
    TS: 7,
    KHOA: 8
  };
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

export async function khoFindById(args, { url, restUrl, token, tableIds, allowPrivate, request }) {
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

  const map = tableIds || loadTableIds();
  const tableId = map[prefix];
  if (!tableId) {
    throw new HubError(
      `Chưa tìm thấy ID bảng cho tiền tố '${prefix}'. Vui lòng chạy lệnh 'kho-schema' để đồng bộ bảng.`,
      404
    );
  }

  const restBase = resolveRestBase({ restUrl, url });
  const rowUrl = `${restBase}/api/database/rows/table/${tableId}/${rowId}/?user_field_names=true`;

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
