/**
 * The Office of the Regional Director is modelled as a Division, with the Records Unit as a
 * Section inside it (decision 152). Its code is fixed at `ORD`, because outgoing correspondence
 * registered there carries `ORD-<year>-<sequence>` permanently and those references are already
 * issued on paper — renaming the division later must not be able to change them (decision 153).
 *
 * Code, not id: the id differs per environment, and the pilot's ORD row is created by
 * configuration rather than by a migration.
 */
export const ORD_DIVISION_CODE = 'ORD';
