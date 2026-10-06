/** Tiny DOM helpers — no framework needed for a UI this size. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export function icon(svg: string, cls = 'ico'): string {
  return `<i class="${cls}" style="display:inline-block">${svg}</i>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function hexColor(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}
