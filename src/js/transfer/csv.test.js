import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CSV_DELIMITER_MESSAGE,
  CSV_MAX_DATA_ROWS,
  CSV_TOO_LARGE_MESSAGE,
  CSV_TOO_MANY_ROWS_MESSAGE,
  parseCsv,
  restoreCsvText,
  serializeCsv
} from './csv.js';

test('CSV writer quotes RFC 4180 fields and round-trips Unicode and long values', () => {
  const long = 'x'.repeat(120_000);
  const text = serializeCsv(['plain', 'number', 'long'], [
    ['a,b', '12.50', long],
    ['line 1\nline "2"', '-4.25', 'ñ ₱ 中文']
  ]);
  assert.ok(text.startsWith('\uFEFF'));
  assert.match(text, /\r\n/);
  const parsed = parseCsv(text);
  assert.equal(parsed.fatal, false);
  assert.deepEqual(parsed.headers, ['plain', 'number', 'long']);
  assert.deepEqual(parsed.records[0].values, ['a,b', '12.50', long]);
  assert.deepEqual(parsed.records[1].values, ['line 1\nline "2"', '-4.25', 'ñ ₱ 中文']);
});

test('CSV reader accepts CRLF, LF and CR, strips BOM, and ignores trailing empty lines', () => {
  for (const newline of ['\r\n', '\n', '\r']) {
    const parsed = parseCsv('\uFEFFa,b' + newline + 'one,two' + newline + newline);
    assert.deepEqual(parsed.headers, ['a', 'b']);
    assert.deepEqual(parsed.records.map((record) => record.row), [2]);
  }
});

test('CSV reader reports ragged rows with spreadsheet row numbers', () => {
  const parsed = parseCsv('a,b\r\none,two\r\nshort\r\n');
  assert.equal(parsed.records.length, 1);
  assert.deepEqual(parsed.errors.map(({ row, column }) => ({ row, column })), [{ row: 3, column: 'CSV row' }]);
  assert.equal(parsed.errors[0].fatal, false);
});

test('CSV reader explains semicolon-separated files', () => {
  const parsed = parseCsv('a;b;c\n1;2;3');
  assert.equal(parsed.fatal, true);
  assert.equal(parsed.errors[0].message, CSV_DELIMITER_MESSAGE);
});

test('CSV reader enforces the 10 MB and 20,000 row limits', () => {
  const tooLarge = parseCsv('a\n' + 'x'.repeat(10 * 1024 * 1024));
  assert.equal(tooLarge.errors[0].message, CSV_TOO_LARGE_MESSAGE);
  const tooMany = parseCsv('a\n' + Array(CSV_MAX_DATA_ROWS + 1).fill('x').join('\n'));
  assert.equal(tooMany.fatal, true);
  assert.equal(tooMany.errors[0].message, CSV_TOO_MANY_ROWS_MESSAGE);
});

test('formula guard round-trips text while leaving negative numeric values alone', () => {
  const text = serializeCsv(
    ['equals_text', 'plus_text', 'minus_text', 'at_text', 'amount'],
    [['=SUM(A1)', '+x', '-x', '@x', '-12.50']],
    { textColumns: ['equals_text', 'plus_text', 'minus_text', 'at_text'] }
  );
  const parsed = parseCsv(text);
  const values = parsed.records[0].values;
  for (const [index, original] of ['=SUM(A1)', '+x', '-x', '@x'].entries()) {
    assert.equal(values[index], `'${original}`);
    assert.equal(restoreCsvText(values[index]), original);
  }
  assert.equal(values[4], '-12.50');
  assert.equal(restoreCsvText("'@x"), '@x');
});
