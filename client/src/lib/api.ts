import { getAccessToken, setAccessToken, clearTokens } from './auth';

// Deduplicates concurrent 401→refresh races so we never make two refresh
// calls simultaneously.
let pendingRefresh: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  if (!pendingRefresh) {
    pendingRefresh = fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    })
      .then(async (r) => {
        if (!r.ok) return null;
        const d = await r.json() as { accessToken: string };
        setAccessToken(d.accessToken);
        return d.accessToken;
      })
      .catch(() => null)
      .finally(() => { pendingRefresh = null; });
  }
  return pendingRefresh;
}

export async function apiFetch(
  path: string,
  options: RequestInit = {},
  isRetry = false,
): Promise<Response> {
  const token = getAccessToken();

  // Don't set Content-Type for FormData — the browser must set it with the
  // multipart boundary. Forcing application/json breaks multer on the server.
  const isFormData = options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers as Record<string, string> | undefined),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(path, { ...options, headers, credentials: 'include' });

  if (res.status === 401 && !isRetry) {
    const newToken = await doRefresh();
    if (newToken) {
      return apiFetch(path, options, true);
    }
    clearTokens();
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  return res;
}

export const bankApi = {
  stats: async (): Promise<{ totalAccepted: number }> =>
    api.get('/api/reference-bank/stats').then(r => r.json()),

  upload: (formData: FormData): Promise<Response> =>
    apiFetch('/api/reference-bank/upload', { method: 'POST', body: formData }),

  reviewQueue: async (uploadId: string) =>
    api.get(`/api/reference-bank/uploads/${uploadId}/review`).then(r => r.json()),

  patchQuestion: async (id: string, body: object) =>
    api.patch(`/api/reference-bank/questions/${id}`, body).then(r => r.json()),

  bulkAccept: async (uploadId: string): Promise<{ accepted: number }> =>
    api.post('/api/reference-bank/questions/bulk-accept', { uploadId }).then(r => r.json()),

  uploads: async () =>
    api.get('/api/reference-bank/uploads').then(r => r.json()),

  deleteUpload: async (uploadId: string): Promise<{ deleted: number }> =>
    api.delete(`/api/reference-bank/uploads/${uploadId}`).then(r => r.json()),

  questions: async (params: Record<string, string | number>) => {
    const q = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, String(v)])),
    ).toString();
    return api.get(`/api/reference-bank/questions?${q}`).then(r => r.json());
  },
};

export const api = {
  get:    (path: string) =>
    apiFetch(path),
  post:   (path: string, body?: unknown) =>
    apiFetch(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  put:    (path: string, body?: unknown) =>
    apiFetch(path, { method: 'PUT',  body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch:  (path: string, body?: unknown) =>
    apiFetch(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined }),
  delete: (path: string) =>
    apiFetch(path, { method: 'DELETE' }),
};
