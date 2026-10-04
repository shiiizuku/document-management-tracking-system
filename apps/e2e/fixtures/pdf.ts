/**
 * A PDF the upload gate accepts and ClamAV finds nothing in.
 *
 * It has to be a real PDF, not a text file with a `.pdf` name: `AttachmentsService` sniffs the
 * media type from the magic bytes and refuses anything outside the allow-list before the scanner
 * ever sees it (policy register P-06). These are the same bytes `apps/api/test/scanner.int.test.ts`
 * uses for its clean case, which is the suite that proves the rest of that pipeline.
 *
 * There is deliberately **no infected fixture here.** Fail-closed is proven against real clamd at
 * the REST layer in `scanner.int.test.ts` — upload, relay, scan, refused download, refused manual
 * override — and re-proving it through a browser would buy nothing but minutes.
 */
export const CLEAN_PDF = Buffer.from('%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

/** As Playwright's `setInputFiles` wants it: no temporary file on disk. */
export const cleanPdfUpload = (
  name: string,
): { name: string; mimeType: string; buffer: Buffer } => ({
  name,
  mimeType: 'application/pdf',
  buffer: CLEAN_PDF,
});
