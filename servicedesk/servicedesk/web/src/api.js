// Thin fetch wrapper that adds the session token and turns errors into readable messages.
const KEY = 'sd_token';

export const session = {
  get token() { try { return localStorage.getItem(KEY); } catch { return null; } },
  set(token) { try { token ? localStorage.setItem(KEY, token) : localStorage.removeItem(KEY); } catch { /* private mode */ } },
};

export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }

  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  if (res.status === 401 && !path.startsWith('/auth/')) {
    session.set(null);
    window.location.href = '/login';
    return new Promise(() => {});
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const qs = (params) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  return s.toString() ? `?${s}` : '';
};

/** Download an attachment with the auth header, then hand it to the browser. */
export async function downloadAttachment(id, filename) {
  const res = await fetch(`/api/attachments/${id}`, { headers: { Authorization: `Bearer ${session.token}` } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not download the file');
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
