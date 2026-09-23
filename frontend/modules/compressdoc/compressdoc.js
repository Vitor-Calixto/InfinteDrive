// compressdoc.js — doc interna estática (só admin vê o botão; sem JS além do show).
const CompressDoc = (() => {
  async function show() {}
  return { show };
})();
window.CompressDoc = CompressDoc;
