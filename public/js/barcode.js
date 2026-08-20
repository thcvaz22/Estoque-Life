/* ============================================================
   BARCODE.JS — leitura de código de barras via câmera
   Usa a lib Html5Qrcode (carregada por CDN em index.html).
   Se estiver offline na primeira visita sem cache, cai no
   modo de digitação manual automaticamente.
   ============================================================ */

let _scannerInstance = null;

async function openBarcodeScanner(onResult) {
  const hasLib = typeof Html5Qrcode !== 'undefined';
  const bodyHTML = hasLib ? `
      <div id="scanner-view" class="scanner-box"></div>
      <p class="hint">Aponte a câmera para o código de barras. Sem acesso à câmera? <button class="link-btn" id="manual-fallback">Digitar código</button></p>
    ` : `
      <p class="hint">Leitor de câmera indisponível offline nesta sessão.</p>
      <input id="manual-code" class="input" placeholder="Digite o código de barras" autofocus />
      <div class="form-actions"><button class="btn btn--primary" id="manual-ok">Usar código</button></div>
    `;
  openModal('Ler código de barras', bodyHTML);

  if (!hasLib) {
    document.getElementById('manual-ok').onclick = () => {
      const val = document.getElementById('manual-code').value.trim();
      closeModal();
      if (val) onResult(val);
    };
    return;
  }

  document.getElementById('manual-fallback').onclick = () => {
    stopScanner();
    openModal('Digitar código de barras', `
      <input id="manual-code" class="input" placeholder="Código de barras" autofocus />
      <div class="form-actions"><button class="btn btn--primary" id="manual-ok">Usar código</button></div>`);
    document.getElementById('manual-ok').onclick = () => {
      const val = document.getElementById('manual-code').value.trim();
      closeModal();
      if (val) onResult(val);
    };
  };

  try {
    _scannerInstance = new Html5Qrcode('scanner-view');
    await _scannerInstance.start(
      { facingMode: 'environment' },
      { fps: 12, qrbox: { width: 260, height: 140 } },
      (decodedText) => {
        const code = decodedText.trim();
        stopScanner();
        closeModal();
        onResult(code);
      },
      () => {} // erros de frame ignorados (varredura contínua)
    );
  } catch (err) {
    document.getElementById('scanner-view').innerHTML = `<p class="hint">Não foi possível acessar a câmera (${escapeHTML(err.message || err)}).</p>`;
  }
}

function stopScanner() {
  if (_scannerInstance) {
    _scannerInstance.stop().then(() => _scannerInstance.clear()).catch(() => {});
    _scannerInstance = null;
  }
}
