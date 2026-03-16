/**
 * Returns an absolute URL to a public asset that works regardless of the
 * deployment base path (e.g. /ID26-TeamA-Spork/ on GitHub Pages or / locally).
 *
 * Usage:  assetUrl('/assets/logo.png')
 */
export const assetUrl = (path: string): string =>
  `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
