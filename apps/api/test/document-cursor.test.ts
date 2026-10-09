import { describe, expect, it } from 'vitest';
import {
  decodeDocumentCursor,
  encodeDocumentCursor,
  type DocumentCursor,
} from '../src/modules/documents/document-cursor.js';

const cursor: DocumentCursor = {
  sort: 'createdAt',
  order: 'desc',
  // Microseconds survive because the value travels as text, not as a Date.
  value: '2026-10-09 07:02:47.123456+00',
  id: '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
};

describe('document cursor', () => {
  it('round-trips the sort, order, value and id exactly', () => {
    expect(decodeDocumentCursor(encodeDocumentCursor(cursor))).toEqual(cursor);
  });

  it('is URL-safe, so it can ride in a query string unescaped', () => {
    expect(encodeDocumentCursor(cursor)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    ['not base64 json', 'not-a-cursor'],
    ['empty', ''],
    ['json that is not an object', Buffer.from('42').toString('base64url')],
    [
      'an unknown sort',
      Buffer.from(JSON.stringify({ ...cursor, sort: 'title' })).toString('base64url'),
    ],
    [
      'an unknown order',
      Buffer.from(JSON.stringify({ ...cursor, order: 'up' })).toString('base64url'),
    ],
    [
      'a missing value',
      Buffer.from(JSON.stringify({ ...cursor, value: '' })).toString('base64url'),
    ],
    [
      'an oversized id',
      Buffer.from(JSON.stringify({ ...cursor, id: 'x'.repeat(65) })).toString('base64url'),
    ],
  ])('refuses %s', (_label, raw) => {
    expect(decodeDocumentCursor(raw)).toBeNull();
  });
});
