import test from 'node:test';
import assert from 'node:assert/strict';
import { barChart, horizontalBars } from './charts.js';

test('bar chart returns an accessible empty state for no buckets', () => {
  const markup = barChart({ labels: [], series: [], ariaLabel: 'Hours per month' });
  assert.match(markup, /aria-label="Hours per month"/);
  assert.match(markup, /No data to chart\./);
  assert.match(markup, /stats-chart-data-table/);
});

test('bar chart draws and tabulates a single value', () => {
  const markup = barChart({ labels: ['Oct'], series: [{ name: 'Hours', values: [7] }] });
  assert.match(markup, /role="img"/);
  assert.match(markup, /class="chart-bar"/);
  assert.match(markup, />7<\/td>/);
});

test('null chart values use an empty marker and a None table value', () => {
  const markup = barChart({ labels: ['Oct'], series: [{ name: 'Received', values: [null] }] });
  assert.match(markup, /class="chart-none"/);
  assert.match(markup, /—/);
  assert.match(markup, />None<\/td>/);
  assert.doesNotMatch(markup, /class="chart-bar"/);
});

test('grouped chart supports two named series and includes their table columns', () => {
  const markup = barChart({
    labels: ['Jan', 'Feb'],
    series: [{ name: 'Received (net)', values: [100, null] }, { name: 'Estimated', values: [90, 110] }],
    ariaLabel: 'Pay history'
  });
  assert.match(markup, /Received \(net\)/);
  assert.match(markup, /Estimated/);
  assert.match(markup, /Pay history/);
  assert.equal((markup.match(/class="chart-bar"/g) || []).length, 3);
});

test('long labels remain complete in the data table and user markup is escaped', () => {
  const hostile = '<script>alert(1)</script>';
  const longLabel = 'A very long company label for the chart';
  const markup = barChart({ labels: [hostile, longLabel], series: [{ name: hostile, values: [1, 2] }] });
  assert.doesNotMatch(markup, /<script>/);
  assert.match(markup, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(markup, /A very long company label for the chart/);
  assert.match(markup, /A very long com…/);
});

test('horizontal bars support status counts with safe labels', () => {
  const markup = horizontalBars({ labels: ['Pending', '<b>Offer</b>'], values: [3, 1], ariaLabel: 'Applications by status' });
  assert.match(markup, /Applications by status/);
  assert.match(markup, /class="chart-bar"/);
  assert.doesNotMatch(markup, /<b>Offer<\/b>/);
  assert.match(markup, /&lt;b&gt;Offer&lt;\/b&gt;/);
  assert.match(markup, />3<\/td>/);
});
