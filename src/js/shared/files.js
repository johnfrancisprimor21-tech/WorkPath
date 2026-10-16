import { DataError } from '../data/errors.js';

export const MAX_TEXT_FILE_BYTES = 10 * 1024 * 1024;
export const FILE_TOO_LARGE_MESSAGE = 'This file is larger than the 10 MB limit. Choose a smaller file.';

export function validateTextFileSize(file, maxBytes = MAX_TEXT_FILE_BYTES) {
  if (!Number.isFinite(maxBytes) || maxBytes < 0) {
    throw new DataError('validation', 'The file size limit is invalid.');
  }
  if (!file || !Number.isFinite(file.size) || file.size < 0) {
    throw new DataError('validation', 'We could not read this file. Choose it again and try once more.');
  }
  if (file.size > maxBytes) {
    throw new DataError('validation', FILE_TOO_LARGE_MESSAGE);
  }
  return true;
}

/** Save text through a browser download; mobile wrappers can replace this boundary later. */
export function saveTextFile(filename, text, mimeType = 'text/plain;charset=utf-8') {
  if (typeof document === 'undefined' || typeof globalThis.URL?.createObjectURL !== 'function') {
    throw new DataError('unknown', 'File downloads are not available in this browser.');
  }
  const blob = new Blob([String(text)], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Pick and read a text file, returning null when the picker is cancelled. */
export function pickTextFile({ accept = 'text/plain', maxBytes = MAX_TEXT_FILE_BYTES } = {}) {
  if (typeof document === 'undefined' || !document.body) {
    return Promise.reject(new DataError('unknown', 'File selection is not available in this browser.'));
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.hidden = true;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      input.remove();
      callback(value);
    };
    input.addEventListener('cancel', () => finish(resolve, null), { once: true });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) {
        finish(resolve, null);
        return;
      }
      try {
        validateTextFileSize(file, maxBytes);
        finish(resolve, { name: file.name, text: await file.text() });
      } catch (error) {
        finish(reject, error instanceof DataError
          ? error
          : new DataError('unknown', 'We could not read this file. Choose it again and try once more.', error));
      }
    }, { once: true });
    document.body.append(input);
    input.click();
  });
}
