export const CSV_MAX_DATA_ROWS = 20_000;
export const CSV_TOO_LARGE_MESSAGE = 'This file is larger than the 10 MB limit. Choose a smaller file.';
export const CSV_TOO_MANY_ROWS_MESSAGE = 'This CSV has more than 20,000 data rows. Split it into smaller files.';
export const CSV_DELIMITER_MESSAGE = 'Save as CSV (comma delimited), then choose the file again.';

const MAX_BYTES = 10 * 1024 * 1024;
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function serializeCsv(headers, rows, { textColumns = [] } = {}) {
  const textNames = new Set(textColumns.map(normalizeHeader));
  const columns = new Set(headers.map(normalizeHeader));
  const protectedColumns = new Set([...textNames].filter((name) => columns.has(name)));
  const records = [headers, ...rows];
  const output = records.map((record) => record.map((value, index) => {
    let text = value == null ? '' : String(value);
    const header = normalizeHeader(headers[index] ?? '');
    if (record !== headers && protectedColumns.has(header) && FORMULA_PREFIX.test(text)) {
      text = "'" + text;
    }
    return quoteField(text);
  }).join(',')).join('\r\n');
  return '\uFEFF' + output + '\r\n';
}

export function parseCsv(text, { maxBytes = MAX_BYTES, maxRows = CSV_MAX_DATA_ROWS } = {}) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  const errors = [];
  const warnings = [];
  if (utf8Length(source) > maxBytes) {
    errors.push({ row: 1, column: 'CSV', message: CSV_TOO_LARGE_MESSAGE, fatal: true });
    return { headers: [], records: [], errors, warnings, fatal: true };
  }

  const delimiter = firstRecordDelimiters(source);
  if (delimiter.semicolons > delimiter.commas && delimiter.semicolons > 0) {
    errors.push({ row: 1, column: 'CSV', message: CSV_DELIMITER_MESSAGE, fatal: true });
    return { headers: [], records: [], errors, warnings, fatal: true };
  }

  const parsed = parseRecords(source);
  if (parsed.error) {
    errors.push({ row: parsed.error.row, column: 'CSV', message: parsed.error.message, fatal: true });
    return { headers: [], records: [], errors, warnings, fatal: true };
  }

  const rows = parsed.records;
  while (rows.length && rows.at(-1).every((cell) => cell === '')) rows.pop();
  if (!rows.length) {
    errors.push({ row: 1, column: 'CSV', message: 'This CSV is empty. Choose a file with a header row.', fatal: true });
    return { headers: [], records: [], errors, warnings, fatal: true };
  }

  const dataRowCount = rows.length - 1;
  const headers = rows.shift().map((header) => header.trim());
  const records = [];
  rows.forEach((values, index) => {
    const row = index + 2;
    if (values.length !== headers.length) {
      errors.push({
        row,
        column: 'CSV row',
        message: `Expected ${headers.length} columns but found ${values.length}.`,
        fatal: false
      });
      return;
    }
    records.push({ row, values });
  });

  if (dataRowCount > maxRows) {
    errors.push({ row: maxRows + 2, column: 'CSV', message: CSV_TOO_MANY_ROWS_MESSAGE, fatal: true });
    return { headers, records: [], errors, warnings, fatal: true };
  }
  return { headers, records, errors, warnings, fatal: false };
}

export function restoreCsvText(value) {
  const text = String(value ?? '');
  return text.length > 1 && text[0] === "'" && FORMULA_PREFIX.test(text[1])
    ? text.slice(1)
    : text;
}

function parseRecords(source) {
  const records = [];
  let record = [];
  let field = '';
  let inQuotes = false;
  let afterQuote = false;
  let logicalRow = 1;
  let sawAny = false;

  const finishField = () => {
    record.push(field);
    field = '';
    afterQuote = false;
  };
  const finishRecord = () => {
    finishField();
    records.push(record);
    record = [];
    logicalRow += 1;
    sawAny = false;
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    sawAny = true;
    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (afterQuote && char !== ',' && char !== '\r' && char !== '\n') {
      return { records, error: { row: logicalRow, message: 'Unexpected text after a quoted CSV field.' } };
    }
    if (char === '"') {
      if (field !== '' || afterQuote) {
        return { records, error: { row: logicalRow, message: 'A quote appeared inside an unquoted CSV field.' } };
      }
      inQuotes = true;
    } else if (char === ',') {
      finishField();
    } else if (char === '\r' || char === '\n') {
      finishRecord();
      if (char === '\r' && source[index + 1] === '\n') index += 1;
    } else {
      field += char;
    }
  }

  if (inQuotes) return { records, error: { row: logicalRow, message: 'A quoted CSV field was not closed.' } };
  if (sawAny || record.length || field !== '' || afterQuote) finishRecord();
  return { records };
}

function firstRecordDelimiters(source) {
  let commas = 0;
  let semicolons = 0;
  let inQuotes = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (inQuotes && source[index + 1] === '"') index += 1;
      else inQuotes = !inQuotes;
    } else if (!inQuotes && (char === '\r' || char === '\n')) {
      break;
    } else if (!inQuotes && char === ',') commas += 1;
    else if (!inQuotes && char === ';') semicolons += 1;
  }
  return { commas, semicolons };
}

function quoteField(value) {
  return /[",\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
}

function normalizeHeader(value) {
  return String(value ?? '').trim().toLocaleLowerCase('en-US');
}

function utf8Length(value) {
  return new TextEncoder().encode(value).length;
}
