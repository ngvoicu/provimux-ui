/**
 * The original console's MIT notice in the built file (PUI-10). The release ships one
 * file, management.html, so the copyright and permission notice of LICENSE (both
 * copyright lines) go into it as an HTML comment right after the doctype.
 *
 * Build-time code, used by vite.config.ts only (one line there): no imports, so the
 * app's TypeScript config, which has no Node types, checks it too. vite.config.ts
 * reads LICENSE and passes its text.
 */

/** The HTML comment carrying the license text, verbatim. */
export function licenseComment(licenseText: string): string {
  const text = licenseText.replace(/\r\n?/g, '\n').trim();
  if (!text) throw new Error('LICENSE is empty; the built console must carry its MIT notice.');
  // A comment cannot hold "--" safely (it may end it early); refuse rather than alter it.
  if (text.includes('--')) throw new Error('LICENSE contains "--"; it cannot go into an HTML comment as is.');
  return `<!--\nprovimux-ui: the CLI Proxy API Management Center with Provimux's layer.\n\n${text}\n-->`;
}

/** The page with the license comment after its doctype (or first, when it has none). */
export function withLicenseNotice(html: string, licenseText: string): string {
  const comment = licenseComment(licenseText);
  const doctype = /^\s*<!doctype html>[ \t]*\r?\n?/i.exec(html);
  if (!doctype) return `${comment}\n${html}`;
  return `${doctype[0].trimEnd()}\n${comment}\n${html.slice(doctype[0].length)}`;
}

/** Vite plugin: adds the license comment to index.html. */
export function provimuxLicenseNotice(licenseText: string) {
  licenseComment(licenseText); // fail at config time, not after a build
  return {
    name: 'provimux-license-notice',
    transformIndexHtml: {
      order: 'post' as const,
      handler: (html: string) => withLicenseNotice(html, licenseText),
    },
  };
}
