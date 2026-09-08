import yauzl from 'yauzl';

// Valida .zip de deploy direto da máquina: barra zip-slip (../, absoluto),
// estouro de descompressão (bomba) e excesso de arquivos — antes de
// qualquer byte viajar para a VPS.
const MAX_FILES = 20000;
const MAX_UNCOMPRESSED = 2 * 1024 * 1024 * 1024; // 2GB
const MAX_NAME = 300;

export function inspectZip(absPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(absPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(new Error('ZIP inválido ou corrompido.'));
      const files = [];
      let total = 0;
      let count = 0;
      zip.on('entry', (e) => {
        const name = e.fileName || '';
        if (/^__MACOSX\//.test(name) || /(^|\/)\._/.test(name) || name.endsWith('/')) {
          zip.readEntry();
          return; // lixo de macOS / diretório: ignora
        }
        count++;
        if (count > MAX_FILES) { zip.close(); return reject(new Error(`ZIP com arquivos demais (limite ${MAX_FILES}).`)); }
        if (name.length > MAX_NAME || name.startsWith('/') || name.startsWith('\\') || /(^|\/)\.\.(\/|$)/.test(name) || name.includes('\0')) {
          zip.close();
          return reject(new Error(`Entrada perigosa bloqueada: ${name.slice(0, 80)}`));
        }
        total += e.uncompressedSize || 0;
        if (total > MAX_UNCOMPRESSED) { zip.close(); return reject(new Error('ZIP grande demais após extrair (limite 2GB).')); }
        files.push({ name, bytes: e.uncompressedSize || 0 });
        zip.readEntry();
      });
      zip.on('end', () => {
        if (files.length === 0) return reject(new Error('ZIP vazio (sem arquivos).'));
        resolve({ files: files.length, totalBytes: total });
      });
      zip.on('error', () => reject(new Error('Falha ao ler ZIP.')));
      zip.readEntry();
    });
  });
}
