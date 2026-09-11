/**
 * Audit export helpers: CSV generation with safe escaping and JSONL streaming.
 * Used by the /api/logs/export endpoint.
 */

// Characters that make spreadsheet software interpret a cell as a formula.
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Escape a single CSV cell value.
 * - Wraps in double-quotes if value contains comma, newline, or double-quote.
 * - Doubles internal double-quotes.
 * - Prepends a single-quote ' to values that start with formula-trigger characters
 *   so Excel / Google Sheets treat them as text.
 * @param {unknown} raw
 * @returns {string}
 */
export function csvCell(raw) {
  const str = raw === null || raw === undefined ? '' : String(raw);

  // Prevent formula injection: prefix dangerous starters with a single-quote.
  // The single-quote is itself escaped inside the quoted string so the final
  // output is: "'=SUM(...)" which spreadsheets render as '=SUM(...)  (text).
  let safe = str;
  if (str.length > 0 && FORMULA_PREFIXES.includes(str[0])) {
    safe = "'" + str;
  }

  // Wrap in double-quotes if the string contains comma, newline, CR, or double-quote.
  if (safe.includes('"') || safe.includes(',') || safe.includes('\n') || safe.includes('\r')) {
    return '"' + safe.replaceAll('"', '""') + '"';
  }
  return safe;
}

/** CSV column order for metadata exports (no payload). */
export const CSV_COLUMNS = ['id', 'created', 'actor', 'mcp', 'tool', 'status', 'latency'];

/** Build a single CSV row string (without trailing newline). */
export function csvRow(row) {
  return CSV_COLUMNS.map(col => csvCell(row[col])).join(',');
}

/** Build the CSV header line. */
export function csvHeader() {
  return CSV_COLUMNS.join(',');
}

/**
 * Manifest injected into every export.
 * @param {object} opts
 * @param {object} opts.filters       - The filter params used (sanitised, no credentials).
 * @param {number} opts.totalRows     - Actual row count in the export.
 * @param {boolean} opts.truncated    - Whether the result was capped at the hard limit.
 * @param {number}  opts.hardLimit    - The hard limit value.
 * @param {number}  opts.retentionDays - Current effective retention in days.
 * @param {string}  opts.format       - 'jsonl' | 'csv'.
 * @returns {object}
 */
export function buildManifest({ filters, totalRows, truncated, hardLimit, retentionDays, format }) {
  return {
    exportedAt: new Date().toISOString(),
    format,
    filters,
    totalRows,
    truncated,
    hardLimit,
    retentionDays,
    schemaVersion: 1
  };
}

/**
 * Collect all matching rows from the store, up to hardLimit, by following cursor pagination.
 *
 * @param {object} store     - The store instance (must expose .logs()).
 * @param {object} filters   - Filter object (same shape as store.logs filters).
 * @param {Function} redactFn - Redact function applied to each row.
 * @param {number} hardLimit - Max rows to collect.
 * @param {boolean} includePayload - Whether to include payload in each row.
 * @returns {{ rows: object[], truncated: boolean }}
 */
export function collectAllRows(store, filters, redactFn, hardLimit, includePayload) {
  const PAGE_SIZE = 1000;
  const rows = [];
  let cursor = undefined;
  let truncated = false;

  while (true) {
    const pageFilters = {
      ...filters,
      paginate: true,
      includePayload,
      cursor,
      limit: PAGE_SIZE
    };
    // Remove undefined cursor to avoid store error
    if (cursor === undefined) delete pageFilters.cursor;

    const result = store.logs(PAGE_SIZE, pageFilters);
    const page = Array.isArray(result) ? result : result.rows || [];

    for (const row of page) {
      if (rows.length >= hardLimit) {
        truncated = true;
        break;
      }
      rows.push(redactFn(row));
    }

    if (truncated) break;

    const hasMore = Array.isArray(result) ? false : result.hasMore;
    if (!hasMore || !page.length) break;

    cursor = Array.isArray(result) ? null : result.nextCursor;
    if (!cursor) break;
  }

  return { rows, truncated };
}

/**
 * Render rows as JSONL + manifest as a final line comment:
 *   #manifest: {...}
 *
 * The manifest is appended as a JSON-comment line so that:
 * - Standard JSONL parsers (which ignore lines starting with #) skip it.
 * - Tools that look for it can parse it easily.
 *
 * @param {object[]} rows
 * @param {object} manifest
 * @returns {string}
 */
export function renderJSONL(rows, manifest) {
  const lines = rows.map(r => JSON.stringify(r));
  lines.push('#manifest: ' + JSON.stringify(manifest));
  return lines.join('\n') + '\n';
}

/**
 * Render rows as CSV with header + manifest comment block at the end.
 *
 * @param {object[]} rows
 * @param {object} manifest
 * @returns {string}
 */
export function renderCSV(rows, manifest) {
  const lines = [csvHeader(), ...rows.map(csvRow)];
  // Append manifest as comment lines at the bottom (not valid CSV rows,
  // but easy to spot; spreadsheets ignore trailing #-prefixed lines).
  lines.push('');
  lines.push('# Export manifest');
  lines.push('# ' + JSON.stringify(manifest));
  return lines.join('\n') + '\n';
}
