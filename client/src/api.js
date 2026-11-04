const KEY = 'peoplehub_token';

export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));

export async function api(path, options = {}) {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...options.headers },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) {
    // Session expired or account disabled: drop back to the login screen.
    setToken(null);
    window.dispatchEvent(new Event('auth:logout'));
  }
  if (!res.ok) throw new Error(data.error ?? 'Request failed');
  return data;
}
