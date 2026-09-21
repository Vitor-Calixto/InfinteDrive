// cloudflare.js — token, zonas, DNS, purge (só admin/dev; backend tranca).
const Cf = (() => {
  async function show() {
    creds();
    zones();
  }
  async function creds() {
    try {
      const list = await jget('/cloudflare');
      $('cfCreds').innerHTML = list.map((c) => `🔑 ${esc(c.label || 'token')} <button class="sp-link" onclick="Cf.delCred('${c.id}')">remover</button>`).join('') || 'Nenhum token salvo.';
    } catch (e) { $('cfCreds').textContent = 'Sem acesso (admin/dev).'; }
  }
  async function save() {
    try {
      await jpost('/cloudflare', { label: $('cf_label').value, token: $('cf_token').value });
      $('cf_token').value = '';
      toast('Token salvo. 🔑');
      creds(); zones();
    } catch (e) { toast('Erro: ' + e.message); }
  }
  async function delCred(id) {
    if (!await confirmDlg('Remover este token?')) return;
    try { await jdel('/cloudflare/' + id); creds(); } catch (e) { toast('Erro: ' + e.message); }
  }
  async function zones() {
    try {
      const z = await jget('/cloudflare/zones');
      const sel = $('cf_zone');
      const cur = sel.value;
      sel.innerHTML = '<option value="">— escolha a zona —</option>' +
        z.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
      if (cur) sel.value = cur;
      if (sel.value) dns();
    } catch (e) { toast('Erro: ' + e.message); }
  }
  async function dns() {
    const zid = $('cf_zone').value;
    const box = $('cfDns');
    if (!zid) { box.innerHTML = ''; return; }
    try {
      const r = await jget(`/cloudflare/zones/${zid}/dns`);
      box.innerHTML = r.map((d) => `<div class="cf-row"><span><b>${esc(d.type)}</b> ${esc(d.name)} → ${esc(d.content)}${d.proxied ? ' ☁' : ''}</span><button class="btn-ghost" onclick="Cf.delDns('${zid}','${d.id}')">x</button></div>`).join('') || '<span class="text-zinc-500">Sem registros.</span>';
    } catch (e) { box.innerHTML = `<span class="text-red-400">${esc(e.message)}</span>`; }
  }
  async function addDns() {
    const zid = $('cf_zone').value;
    if (!zid) return toast('Escolha a zona.');
    try {
      await jpost(`/cloudflare/zones/${zid}/dns`, {
        type: ($('cf_type').value || 'A').toUpperCase(),
        name: $('cf_name').value.trim(),
        content: $('cf_content').value.trim(),
        proxied: $('cf_proxied').checked,
      });
      $('cf_name').value = ''; $('cf_content').value = '';
      toast('DNS criado. ✅');
      dns();
    } catch (e) { toast('Erro: ' + e.message); }
  }
  async function delDns(zid, id) {
    if (!await confirmDlg('Apagar este registro DNS?')) return;
    try { await jdel(`/cloudflare/zones/${zid}/dns/${id}`); dns(); } catch (e) { toast('Erro: ' + e.message); }
  }
  async function purge() {
    const zid = $('cf_zone').value;
    if (!zid) return toast('Escolha a zona.');
    if (!await confirmDlg('Limpar TODO o cache da zona?')) return;
    try { await jpost(`/cloudflare/zones/${zid}/purge`, {}); toast('Cache limpo. 🧹'); } catch (e) { toast('Erro: ' + e.message); }
  }
  return { show, save, delCred, zones, dns, addDns, delDns, purge };
})();
window.Cf = Cf;
