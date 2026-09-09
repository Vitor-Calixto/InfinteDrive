// twofa.js — gerenciar 2FA (QR, ativar, desligar). UI mora no card da view Conta.
const TwoFA = (() => {
  function paint(user) {
    const el = $('tfaState');
    if (el) el.textContent = user?.tfaEnabled ? '🔒 Ativado neste login.' : 'Desligado.';
  }
  async function setup() {
    try {
      const r = await jpost('/auth/2fa/setup', {});
      $('tfaQr').src = r.qr;
      $('tfaSecret').textContent = 'Segredo: ' + r.secret;
      $('tfaSetup').hidden = false;
      $('tfaBackup').hidden = true;
    } catch (e) { toast('Erro: ' + e.message); }
  }
  async function enable() {
    try {
      const r = await jpost('/auth/2fa/enable', { token: $('tfa_code2').value });
      $('tfaBackup').textContent = 'CÓDIGOS RESERVA (salve agora, 1 uso cada):\n' + (r.codes || []).join('\n');
      $('tfaBackup').hidden = false;
      try { await Auth.me(); } catch {}
      paint(window._user);
      toast('2FA ativado. Guarde os códigos reserva.');
    } catch (e) { toast('Erro: ' + e.message); }
  }
  async function disable() {
    const pw = await inputDlg('Senha atual para desligar o 2FA:', { password: true });
    if (pw === null) return;
    try {
      await jpost('/auth/2fa/disable', { password: pw });
      const s = $('tfaSetup');
      if (s) s.hidden = true;
      try { await Auth.me(); } catch {}
      paint(window._user);
    } catch (e) { toast('Erro: ' + e.message); }
  }
  return { paint, setup, enable, disable };
})();
window.TwoFA = TwoFA;
