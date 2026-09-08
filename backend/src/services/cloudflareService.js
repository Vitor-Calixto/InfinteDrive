// Cloudflare sem dashboard: token escopado (DNS:edit + Cache purge na zona)
// guardado AES-GCM como as credenciais Contabo/SSH.
const API = 'https://api.cloudflare.com/client/v4';

function headers(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function cf(token, method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: headers(token),
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) {
    const msg = (j.errors || []).map((e) => e.message).join('; ') || `HTTP ${r.status}`;
    throw new Error(`Cloudflare: ${msg.slice(0, 200)}`);
  }
  return j.result;
}

export const cloudflareService = {
  listZones: (t) => cf(t, 'GET', '/zones?per_page=20'),
  listDns: (t, zone) => cf(t, 'GET', `/zones/${zone}/dns_records?per_page=100`),
  createDns: (t, zone, { type, name, content, proxied = true, ttl = 1 }) => {
    if (!['A', 'AAAA', 'CNAME', 'TXT'].includes(type)) throw new Error('Tipo DNS inválido.');
    if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(name)) throw new Error('Nome DNS inválido.');
    if (!content || String(content).length > 255) throw new Error('Conteúdo DNS inválido.');
    return cf(t, 'POST', `/zones/${zone}/dns_records`, { type, name, content, proxied, ttl });
  },
  deleteDns: (t, zone, id) => cf(t, 'DELETE', `/zones/${zone}/dns_records/${id}`),
  purgeCache: (t, zone) => cf(t, 'POST', `/zones/${zone}/purge_cache`, { purge_everything: true }),
};
