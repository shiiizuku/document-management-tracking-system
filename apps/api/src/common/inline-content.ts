/**
 * What a response served with an `inline` disposition is permitted to do once it is in the browser.
 *
 * `default-src 'none'` with only `img-src 'self'` leaves a PDF or an image able to render itself
 * and nothing else: no script, no stylesheet, no frame, and no outbound request — so a crafted
 * document cannot phone home or reach anything in the session that fetched it. `sandbox` drops the
 * response into an opaque origin, which is what stops it scripting its way back to the app even
 * though it is served from the API's own host.
 *
 * Shared by the attachment preview and the routing-slip preview. The slip is our own PDF and is
 * trusted content, so the sandbox buys nothing there — but it costs nothing either, and this rule
 * is the kind that should have one home: two copies drift, and the copy that drifts is the one on
 * the route serving bytes that came from outside the office.
 */
export const INLINE_CONTENT_CSP =
  "default-src 'none'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; sandbox";
