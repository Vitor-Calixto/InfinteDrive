// terms.js — Termos de Uso (view + modal). Aceite obrigatório no cadastro.
const Terms = (() => {
  const HTML = `
  <p><b>1. O serviço.</b> O Deploy Center guarda seus arquivos com compressão para ocupar menos espaço. Entregamos "como está", sem garantia de disponibilidade contínua.</p>
  <p><b>2. Seus dados, sua responsabilidade.</b> Mantenha cópia do que for insubstituível. <b>Perda de dados — por qualquer motivo (falha, exclusão, lixeira esvaziada, conta encerrada) — não gera responsabilidade nossa nem indenização.</b> Ao usar, você declara ciência disso.</p>
  <p><b>3. Conta e acesso.</b> E-mail, senha, 2FA e PINs são seus: não compartilhe. Redefinições pelo admin são auditadas.</p>
  <p><b>4. Conteúdo.</b> Proibido guardar ou compartilhar conteúdo ilegal, pirataria ou que viole direitos de terceiros. Conta pode ser suspensa sem aviso e sem reembolso.</p>
  <p><b>5. Planos e quota.</b> Quota é limite técnico, não promessa de espaço livre. Compressão varia por conteúdo (números exibidos são medidos, não garantidos).</p>
  <p><b>6. Privacidade.</b> Guardamos nome, e-mail, telefone e arquivos. E-mail não aparece na lista do admin (só telefone); buscas e redefinições são registradas em auditoria. Nada é vendido.</p>
  <p><b>7. Alterações.</b> Podemos mudar funções e estes termos; uso contínuo = aceite.</p>`;
  function show() {
    const b = $('termsBody');
    if (b) b.innerHTML = HTML;
  }
  function open() {
    const m = $('termsBox'), b = $('termsBoxBody');
    if (!m || !b) return;
    b.innerHTML = HTML;
    m.hidden = false;
  }
  function close() { const m = $('termsBox'); if (m) m.hidden = true; }
  return { show, open, close };
})();
window.Terms = Terms;
