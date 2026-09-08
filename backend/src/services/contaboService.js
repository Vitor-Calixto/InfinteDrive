import { v4 as uuidv4 } from 'uuid';

const AUTH_URL = 'https://auth.contabo.com/auth/realms/contabo/protocol/openid-connect/token';
const API_BASE = 'https://api.contabo.com/v1';

let cache = { token: null, exp: 0 };

// Credenciais vêm do body da requisição (guardadas criptografadas no store do dashboard),
// nunca hardcoded. Formato: { clientId, clientSecret, apiUser, apiPassword }
export async function getAccessToken(creds) {
  const now = Date.now();
  if (cache.token && now < cache.exp - 30_000 && cache.key === creds.clientId) return cache.token;
  const params = new URLSearchParams({
    grant_type: 'password',
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    username: creds.apiUser,
    password: creds.apiPassword,
  });
  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  if (!res.ok) throw new Error(`Falha auth Contabo (${res.status}): verifique client_id/secret/user/pass em my.contabo.com > API`);
  const json = await res.json();
  cache = { token: json.access_token, exp: now + (json.expires_in || 300) * 1000, key: creds.clientId };
  return cache.token;
}

async function api(creds, method, path, body) {
  const token = await getAccessToken(creds);
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'x-request-id': uuidv4(),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Contabo ${method} ${path} -> ${res.status}: ${txt.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const contaboService = {
  getAccessToken,
  listInstances: (c) => api(c, 'GET', '/compute/instances?size=50'),
  getInstance: (c, id) => api(c, 'GET', `/compute/instances/${id}`),
  instanceAction: (c, id, action) => api(c, 'POST', `/compute/instances/${id}/actions/${action}`, {}), // start|restart|stop|shutdown
  listAudits: (c) => api(c, 'GET', '/compute/instances/audits?size=20'),
  listSnapshots: (c) => api(c, 'GET', '/compute/snapshots?size=20'),
  listImages: (c) => api(c, 'GET', '/compute/images?size=50'),
  listStorages: (c) => api(c, 'GET', '/object-storages').catch(() => ({ data: [], note: 'sem object storage ou sem permissão' })),
};
