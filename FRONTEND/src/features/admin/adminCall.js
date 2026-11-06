import { adminFetch } from './adminApi';

// adminFetch wants the body as a plain object and stringifies it itself
export const api = (path, method = 'GET', body) => adminFetch(path, { method, body });

export function saveFile({ filename, mime, base64 }) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}