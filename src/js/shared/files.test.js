import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FILE_TOO_LARGE_MESSAGE,
  MAX_TEXT_FILE_BYTES,
  PRINT_UNAVAILABLE_MESSAGE,
  printReport,
  validateTextFileSize
} from './files.js';

test('file size helper accepts the limit and rejects larger files with a plain message', () => {
  assert.equal(MAX_TEXT_FILE_BYTES, 10 * 1024 * 1024);
  assert.equal(validateTextFileSize({ size: MAX_TEXT_FILE_BYTES }), true);
  assert.throws(
    () => validateTextFileSize({ size: MAX_TEXT_FILE_BYTES + 1 }),
    (error) => error.code === 'validation' && error.message === FILE_TOO_LARGE_MESSAGE
  );
});

test('file size helper rejects missing files and invalid limits', () => {
  assert.throws(() => validateTextFileSize(null), /could not read this file/i);
  assert.throws(() => validateTextFileSize({ size: 1 }, Number.NaN), /size limit is invalid/i);
});

test('print report gives a plain message when printing is unavailable', () => {
  assert.throws(
    () => printReport({ title: 'Workpath report', render: () => '<p>Report</p>' }),
    (error) => error.message === PRINT_UNAVAILABLE_MESSAGE
  );
});
