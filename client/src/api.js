let userId = Number(localStorage.getItem('userId') ?? 1);

export const getUserId = () => userId;
export const setUserId = (id) => {
  userId = id;
  localStorage.setItem('userId', String(id));
};

export async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-user-id': String(userId), ...options.headers },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Request failed');
  return data;
}
