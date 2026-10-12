import test from 'node:test';
import assert from 'node:assert/strict';
import { countApplicationStatuses, isValidEmail, isValidHttpUrl } from './helpers.js';

test('accepts only absolute HTTP and HTTPS job links', () => {
  assert.equal(isValidHttpUrl(''), true);
  assert.equal(isValidHttpUrl('https://jobs.example.com/role'), true);
  assert.equal(isValidHttpUrl('http://example.com'), true);
  assert.equal(isValidHttpUrl('javascript:alert(1)'), false);
  assert.equal(isValidHttpUrl('/relative/path'), false);
  assert.equal(isValidHttpUrl('not a url'), false);
});

test('validates optional email addresses', () => {
  assert.equal(isValidEmail(''), true);
  assert.equal(isValidEmail('person@example.com'), true);
  assert.equal(isValidEmail('person@localhost'), false);
  assert.equal(isValidEmail('two words@example.com'), false);
});

test('counts all applications by status, including zero counts', () => {
  const counts = countApplicationStatuses([
    { status: 'pending' },
    { status: 'interview' },
    { status: 'pending' },
    { status: 'no_response' }
  ]);
  assert.deepEqual(counts, {
    all: 4,
    pending: 2,
    interview: 1,
    offer: 0,
    rejected: 0,
    no_response: 1
  });
});
