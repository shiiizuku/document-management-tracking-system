import { documentPrioritySchema, storedWorkflowStatusSchema } from '@dts/contracts';

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
  /**
   * Which list issued it. Absent for the registry; `'assigned'` for the work queue. Without it a
   * registry cursor sorted by date would be accepted by the queue and start it mid-way.
   */
  list?: 'assigned';
  /** The last row's id: the tie-break, so rows sharing a sort value keep a total order. */
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)?$/;
const SORTS: readonly string[] = ['createdAt', 'priority', 'status'];
const ORDERS: readonly string[] = ['asc', 'desc'];

export const encodeDocumentCursor = (cursor: DocumentCursor): string =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

/** `null` for anything that is not a cursor this module issued, whatever shape it arrives in. */
export const decodeDocumentCursor = (raw: string): DocumentCursor | null => {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { sort, order, value, id, list } = parsed as Record<string, unknown>;
    if (typeof sort !== 'string' || !SORTS.includes(sort)) return null;
    if (typeof order !== 'string' || !ORDERS.includes(order)) return null;
    if (typeof value !== 'string' || value === '' || value.length > 64) return null;
    if (typeof id !== 'string' || !UUID.test(id)) return null;
    if (list !== undefined && list !== 'assigned') return null;
    // Postgres casts these back to the column's type; anything it cannot parse would be a 500.
    const valid =
      sort === 'priority'
        ? documentPrioritySchema.safeParse(value).success
        : sort === 'status'
          ? storedWorkflowStatusSchema.safeParse(value).success
          : TIMESTAMP.test(value);
    if (!valid) return null;
    return {
      sort: sort as DocumentSortField,
      order: order as DocumentSortOrder,
      value,
      id,
      ...(list === 'assigned' ? { list } : {}),
    };
  } catch {
    return null;
  }
};
