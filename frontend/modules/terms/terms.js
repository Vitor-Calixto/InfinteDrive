// terms.js — Termos de Uso v1.1 (view + modal + trava de acesso). Aceite com data/hora.
const Terms = (() => {
  const HTML = `
  <p><b>1. Aceite obrigatório.</b> O uso só é permitido após o aceite. Sem aceite, o acesso é negado. O uso contínuo após alterações equivale a novo aceite.</p>
  <p><b>2. Objeto.</b> Guarda de arquivos com compressão, playlists/perfis, cofre e importação de terceiros. Entregue "como está", sem garantia de disponibilidade, desempenho ou resultado — incluindo taxas de compressão, que são medidas e variam por conteúdo.</p>
  <p><b>3. Conta e credenciais.</b> E-mail, senha, 2FA, PINs e códigos são de responsabilidade exclusiva do usuário. Compartilhar acesso = assumir todos os atos de quem usar. Comprometimento deve ser comunicado de imediato; até lá, atos na conta presumem-se do titular.</p>
  <p><b>4. Seus dados, seus backups.</b> Mantenha cópia própria do insubstituível. <b>Não garantimos integridade, permanência ou recuperação — inclusive contra falha, ataque, erro operacional, exclusão (acidental ou por terceiros com acesso), lixeira esvaziada ou encerramento.</b></p>
  <p><b>5. Isenção e limite.</b> Sem responsabilidade por perda de dados, lucros cessantes ou danos indiretos/morais. Teto: valores pagos nos 3 meses anteriores (zero em plano gratuito).</p>
  <p><b>6. Conteúdo e indenização.</b> Você responde pelo que guarda/compartilha e declara deter direitos. Proibido ilegal, pirataria, violação de direitos, ódio, fraude, malware e sobrecarga do serviço. <b>Você nos indeniza de qualquer reclamação, custo, multa ou condenação de terceiros decorrente do seu uso.</b></p>
  <p><b>7. Suspensão e encerramento.</b> Podemos suspender/encerrar sem aviso em violação, abuso, inadimplência ou ordem legal — sem reembolso proporcional. Encerrada, a conta tem dados apagados após a lixeira.</p>
  <p><b>8. Planos, quota e pagamento.</b> Quota é limite técnico. Compressão é melhor esforço. Sem reembolso proporcional por suspensão prevista aqui.</p>
  <p><b>9. Privacidade.</b> Nome, e-mail, telefone e arquivos para operar. E-mail fora da lista do admin (só telefone); buscas e resets auditados. Nada vendido. Direitos LGPD pelo suporte.</p>
  <p><b>10. Terceiros.</b> Login, importação (Google), DNS e entrega dependem de terceiros; indisponibilidade deles não é nossa responsabilidade.</p>
  <p><b>11. Alterações.</b> Funções e Termos mudam com aviso no app; uso após aviso = aceite.</p>
  <p><b>12. Lei e foro.</b> Legislação brasileira; foro do domicílio do usuário, ressalvadas regras consumeristas.</p>
  <p><b>13. Idade e conta pessoal.</b> Menores de 18 só com responsável, que responde integralmente. Conta pessoal e intransferível.</p>
  <p><b>14. Sem SLA.</b> Suporte por melhor esforço, sem prazo. Beta pode quebrar e sumir sem aviso.</p>
  <p><b>15. Preços e recursos mudam.</b> Planos, preços, quotas e limites mudam com aviso. Promoção não vira direito adquirido.</p>
  <p><b>16. Inatividade e exportação.</b> Conta parada 12+ meses pode ser suspensa/apagada após aviso por e-mail. Exporte quando quiser; após encerramento não há recuperação.</p>
  <p><b>17. Automação e reversa.</b> Proibido scraper, bot, brute force, revenda de acesso, extração de código e burla de limites. Tentativa = suspensão imediata.</p>
  <p><b>18. Incidentes.</b> Avisaremos por e-mail quando exigido; o aviso não é admissão de culpa ou dano.</p>
  <p><b>19. Marca.</b> Nome, logo e código são nossos. Nada transfere propriedade intelectual.</p>
  <p><b>20. Independência.</b> Se um item cair, os demais valem. Estes Termos são o acordo integral.</p>
  <p class="hint">v1.1 — aceite registrado com data, hora e conta. Em revisão por advogado.</p>`;
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
  // Trava de acesso: logado sem aceite só sai daqui aceitando.
  async function gate() {
    open();
    const m = $('termsBox');
    if (!m) return false;
    return new Promise((resolve) => {
      const row = document.createElement('div');
      row.className = 'sp-confirm-row mt-2';
      row.innerHTML = `<button id="termsYes" class="btn">Aceito</button><button id="termsNo" class="btn-ghost">Não aceito</button>`;
      m.querySelector('.sp-confirm')?.appendChild(row);
      const done = (v) => { row.remove(); resolve(v); };
      $('termsYes').onclick = async () => {
        try { await jpatch('/auth/accept-terms', {}); close(); done(true); }
        catch (e) { toast('Erro: ' + e.message); }
      };
      $('termsNo').onclick = () => { close(); done(false); };
    });
  }
  return { show, open, close, gate, version: '1.1' };
})();
window.Terms = Terms;
