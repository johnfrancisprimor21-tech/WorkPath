import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addCalendarDay,
  localDateTimeToUtc,
  utcToLocalDateTime
} from './time.js';

test('converts Manila local time to UTC and back', () => {
  const utc = localDateTimeToUtc('2026-01-15', '08:30', 'Asia/Manila');
  assert.equal(utc, '2026-01-15T00:30:00.000Z');
  assert.deepEqual(utcToLocalDateTime(utc, 'Asia/Manila'), { date: '2026-01-15', time: '08:30' });
});

test('rejects skipped New York spring-forward time', () => {
  assert.throws(
    () => localDateTimeToUtc('2026-03-08', '02:30', 'America/New_York'),
    /does not exist/
  );
});

test('uses the first occurrence of a repeated New York fall-back time', () => {
  const utc = localDateTimeToUtc('2026-11-01', '01:30', 'America/New_York');
  assert.equal(utc, '2026-11-01T05:30:00.000Z');
});

test('converts an overnight Manila shift across the next local day', () => {
  const start = localDateTimeToUtc('2026-02-10', '22:00', 'Asia/Manila');
  const endDate = addCalendarDay('2026-02-10');
  const end = localDateTimeToUtc(endDate, '06:00', 'Asia/Manila');
  assert.equal(endDate, '2026-02-11');
  assert.equal((Date.parse(end) - Date.parse(start)) / 60000, 480);
  assert.deepEqual(utcToLocalDateTime(end, 'Asia/Manila'), { date: '2026-02-11', time: '06:00' });
});
