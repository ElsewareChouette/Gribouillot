/**
 * Toolbar icons, shared with the desktop version (resources/icons).
 */

const urls = import.meta.glob('../../../resources/icons/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const byName = new Map(Object.entries(urls).map(([path, url]) => [path.split('/').pop()!, url]));

export function icon(name: string): string {
  return byName.get(name) ?? '';
}
