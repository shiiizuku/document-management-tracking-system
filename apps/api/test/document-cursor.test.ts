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
    [
      'an id that is not a uuid',
      Buffer.from(JSON.stringify({ ...cursor, id: 'invalid' })).toString('base64url'),
    ],
    [
      'a date sort value that is not a timestamp',
      Buffer.from(JSON.stringify({ ...cursor, value: 'invalid' })).toString('base64url'),
    ],
    [
      'a priority that is not one',
      Buffer.from(JSON.stringify({ ...cursor, sort: 'priority', value: 'SOON' })).toString(
        'base64url',
      ),
    ],
    [
      'an unknown list',
      Buffer.from(JSON.stringify({ ...cursor, list: 'registry' })).toString('base64url'),
    ],
  ])('refuses %s', (_label, raw) => {
    expect(decodeDocumentCursor(raw)).toBeNull();
  });

  it('keeps the list it was issued for', () => {
    const queue: DocumentCursor = { ...cursor, list: 'assigned' };
    expect(decodeDocumentCursor(encodeDocumentCursor(queue))).toEqual(queue);
  });

  it('accepts the timestamp and enum values the repository emits', () => {
    for (const value of ['2026-10-09 07:02:47+00', '2026-10-09 07:02:47.5-07:30'])
      expect(decodeDocumentCursor(encodeDocumentCursor({ ...cursor, value }))).not.toBeNull();
    expect(
      decodeDocumentCursor(encodeDocumentCursor({ ...cursor, sort: 'priority', value: 'URGENT' })),
    ).not.toBeNull();
    expect(
      decodeDocumentCursor(
        encodeDocumentCursor({ ...cursor, sort: 'status', value: 'FOR_RELEASE' }),
      ),
    ).not.toBeNull();
  });
});
