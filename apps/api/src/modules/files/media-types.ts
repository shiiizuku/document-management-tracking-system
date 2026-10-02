/**
 * What the system accepts, previews and releases, by media type.
 *
 * A module of its own rather than constants on `AttachmentsService`, because the release gate is
 * enforced in the file-versions repository and the upload gate in the service: with the policy
 * living in the service, the repository importing it would close an import cycle. Three sets in
 * one file also makes their differences visible side by side, which is the part worth reviewing.
 *
 * Policy register P-06. Every set is checked against the media type sniffed from the file's magic
 * bytes, never against its filename or declared header.
 */

/**
 * What may be stored at all.
 *
 * The two Office entries are the plain OOXML types. Their macro-enabled counterparts carry
 * distinct media types (`application/vnd.ms-word.document.macroEnabled.12` and its Excel twin),
 * so naming only these refuses `.docm`/`.xlsm` without needing a second rule — and a bare ZIP
 * renamed `.docx` sniffs as `application/zip`, so it is refused too.
 */
export const ALLOWED_ATTACHMENT_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/**
 * What a browser is asked to render in place rather than hand over as a file (D-82).
 *
 * This was once defined as the allow-list itself, on the reasoning that every accepted format was
 * accepted *because* it previews safely. Admitting Office documents ended that: they are storable
 * but not renderable. Listing the two sets separately is the deliberate edit that the derivation
 * existed to force, rather than a quiet widening of what renders.
 */
export const PREVIEWABLE_ATTACHMENT_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

/**
 * What satisfies the release gate (D-83).
 *
 * Fixed-form only. An outgoing record has to be an artefact of what was actually sent, and a
 * `.docx` is editable — two people holding the same file can open it and read different text,
 * which is the condition D-71's immutable-version rule exists to rule out. Office documents may
 * still be attached as working files; they just cannot be what a release is evidenced by.
 *
 * Equal to the previewable set today, and deliberately a separate name: the two answer different
 * questions, and a format that becomes renderable later is not thereby fit to carry a release.
 */
export const RELEASABLE_ATTACHMENT_MEDIA_TYPES: ReadonlySet<string> =
  PREVIEWABLE_ATTACHMENT_MEDIA_TYPES;

/**
 * What a refused upload tells the person holding the file.
 *
 * Named here beside the allow-list so the message and the rule cannot drift apart. A deliberate
 * policy that reads as a malfunction generates support load; this one says what to do instead.
 */
export const UNSUPPORTED_MEDIA_TYPE_MESSAGE =
  'Accepted formats are PDF, PNG, JPEG, WebP, Word (.docx) and Excel (.xlsx). ' +
  'Convert other Office documents to PDF, and unpack archives, before uploading.';
