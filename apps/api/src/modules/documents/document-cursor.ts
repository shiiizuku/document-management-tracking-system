/**
 * The opaque cursor behind the registry's continuous list.
 *
 * Offset paging answers "rows 40 to 59", which stops meaning anything the moment a row is
 * registered or changes status between two requests: one is shown twice, another never. A cursor
 * answers "the rows after this one, in this order", and that stays true however the table moves.
 *
 * It carries the **sort and order it was issued under**, so a cursor from a differently sorted list
 * is refused instead of silently continuing from the wrong place, and the **sort value as text**
 * rather than a number or a `Date`: a timestamp keeps its microseconds that way (a JavaScript
 * `Date` would drop them and let two rows created in the same millisecond swap places), and an
 * enum keeps its label for Postgres to order by its own declaration rank.
 */
export type DocumentSortField = 'createdAt' | 'priority' | 'status';
export type DocumentSortOrder = 'asc' | 'desc';

export interface DocumentCursor {
  sort: DocumentSortField;
  order: DocumentSortOrder;
  /** The last row's sort value, as Postgres prints it. */
  value: string;
  /** The last row's id: the tie-break, so rows sharing a sort value keep a total order. */
  id: string;
}

const SORTS: readonly string[] = ['createdAt', 'priority', 'status'];
const ORDERS: readonly string[] = ['asc', 'desc'];

export const encodeDocumentCursor = (cursor: DocumentCursor): string =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

/** `null` for anything that is not a cursor this module issued, whatever shape it arrives in. */
export const decodeDocumentCursor = (raw: string): DocumentCursor | null => {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { sort, order, value, id } = parsed as Record<string, unknown>;
    if (typeof sort !== 'string' || !SORTS.includes(sort)) return null;
    if (typeof order !== 'string' || !ORDERS.includes(order)) return null;
    if (typeof value !== 'string' || value === '' || value.length > 64) return null;
    if (typeof id !== 'string' || id === '' || id.length > 64) return null;
    return { sort: sort as DocumentSortField, order: order as DocumentSortOrder, value, id };
  } catch {
    return null;
  }
};
