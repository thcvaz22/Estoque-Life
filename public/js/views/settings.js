/* ============================================================
   VIEWS/SETTINGS.JS — Configurações
   Usuário atual (auditoria), status do servidor/rede e backup
   completo do banco (agora feito pelo próprio servidor).
   ============================================================ */

async function renderSettings(root) {
  if (!(typeof Auth !== 'undefined' && Auth.isManager && Auth.isManager())) {
    root.innerHTML = `<div class="empty-state"><div class="big">🔒</div><p>Configurações são restritas ao perfil Gerente.</p></div>`;
    return;
  }
  const sessionUser = (typeof Auth !== 'undefined' && Auth.currentUser) ? Auth.currentUser() : null;
  const counts = await Promise.all(['products', 'lots', 'entries', 'exits', 'backlog', 'losses', 'inventories', 'history', 'fiscalInvoices'].map(s => DB.all(s).then(a => [s, a.length])));

  let health = null;
  try { health = await (await fetch('/api/health')).json(); } catch (e) { /* servidor pode estar fora do ar */ }
  let aionStatus = null;
  try { aionStatus = await apiFetch('/aion/status'); } catch (e) { /* status opcional */ }
  const depositProfile = await DB.get('meta','deposit_profile') || {};
  let fiscalCapabilities = null;
  try { fiscalCapabilities = await fiscalFetch('/capabilities'); } catch (e) { /* módulo fiscal opcional */ }

  root.innerHTML = `
    <div class="grid grid--2">
      <div class="card">
        <div class="section-title" style="margin-top:0">Sessão atual</div>
        <p class="hint">O responsável das movimentações é definido automaticamente pelo login e não pode ser alterado manualmente.</p>
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
          <div><span class="hint">Usuário</span><div><strong>${escapeHTML(sessionUser ? sessionUser.nome : '—')}</strong></div></div>
          <div><span class="hint">Login</span><div class="cell-mono">${escapeHTML(sessionUser ? sessionUser.username : '—')}</div></div>
          <div><span class="hint">Perfil</span><div>${escapeHTML(sessionUser ? sessionUser.perfil : '—')}</div></div>
          <div><span class="hint">Auditoria</span><div>${escapeHTML(sessionUser ? sessionUser.auditLabel : '—')}</div></div>
        </div>
      </div>

      <div class="card">
        <div class="section-title" style="margin-top:0">Conexão e nuvem</div>
        ${health?.cloudMode ? `
          <p class="hint">O sistema está rodando em modo nuvem. Vendedores podem acessar sem o computador da empresa estar ligado.</p>
          <div style="display:flex;flex-direction:column;gap:7px;margin-top:10px">
            <span class="pill" style="width:fit-content">☁️ Servidor em nuvem</span>
            <span class="cell-mono pill" style="width:fit-content">${escapeHTML(health.publicBaseUrl || 'URL pública não informada')}</span>
            ${health.sellerUrl ? `<span class="cell-mono pill" style="width:fit-content">Vendas: ${escapeHTML(health.sellerUrl)}</span>` : ''}
          </div>
        ` : `
          <p class="hint">Modo local. Para abrir na mesma rede Wi-Fi, use um dos endereços abaixo. Quando hospedado em nuvem, esta caixa mostrará a URL pública dos vendedores.</p>
          ${health && health.lanUrls && health.lanUrls.length > 0 ? `<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">${health.lanUrls.map(u => `<span class="cell-mono pill" style="width:fit-content">${escapeHTML(u)}</span>`).join('')}</div>` : `<p class="hint">Nenhum endereço de rede disponível no momento.</p>`}
        `}
      </div>

      <div class="card">
        <div class="section-title" style="margin-top:0">Backup completo</div>
        <p class="hint">A v15 cria backups íntegros automáticos do SQLite. O backup JSON v6 inclui também os usuários (com hashes de senha, nunca senha em texto) para facilitar a migração do banco local para a nuvem. Sessões não são copiadas.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" id="st-export">⬇️ Exportar backup (.json)</button>
          <button class="btn" id="st-export-sqlite">☁️ Baixar banco SQLite</button>
          <label class="btn" for="st-import">⬆️ Restaurar backup</label>
          <input type="file" id="st-import" accept=".json" hidden>
        </div>
      </div>

      <div class="card">
        <div class="section-title" style="margin-top:0">AION IA · Internet</div>
        <p class="hint">A AION usa os dados internos localmente e, quando configurada no servidor, pode consultar a IA externa e pesquisar informações atuais na web sem enviar listas de clientes.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <span class="pill">${aionStatus?.externalAI ? '✅ IA externa conectada' : '⚪ IA externa não configurada'}</span>
          <span class="pill">${aionStatus?.webSearch ? '🌐 Pesquisa web ativa' : '🌐 Pesquisa web inativa'}</span>
          ${aionStatus?.model ? `<span class="pill cell-mono">${escapeHTML(aionStatus.model)}</span>` : ''}
        </div>
      </div>

      <div class="card">
        <div class="section-title" style="margin-top:0">Migração para nuvem</div>
        <p class="hint">Para levar os dados atuais à nuvem sem perder cadastros e senhas: exporte o backup JSON nesta instalação local e restaure o mesmo arquivo na instalação em nuvem. Após restaurar usuários, o sistema encerra as sessões por segurança e você entra novamente com sua senha atual.</p>
        <span class="pill">☁️ ${health?.cloudMode ? 'Esta instalação já está na nuvem' : 'Esta instalação está local'}</span>
      </div>


      <div class="card field--full" style="grid-column:1/-1">
        <div class="section-title" style="margin-top:0">Dados do depósito / emitente</div>
        <p class="hint">Esses dados aparecem no topo do romaneio de recebimento e serão a base da configuração da emissão de NF-e.</p>
        <div class="form-grid form-grid--3">
          <div class="field field--full"><label>Razão social</label><input class="input" id="dp-razao" value="${escapeHTML(depositProfile.razaoSocial||'')}"></div>
          <div class="field"><label>Nome fantasia</label><input class="input" id="dp-fantasia" value="${escapeHTML(depositProfile.nomeFantasia||'')}"></div>
          <div class="field"><label>CNPJ</label><input class="input" id="dp-cnpj" value="${escapeHTML(depositProfile.cnpj||'')}"></div>
          <div class="field"><label>Inscrição estadual</label><input class="input" id="dp-ie" value="${escapeHTML(depositProfile.inscricaoEstadual||'')}"></div>
          <div class="field"><label>Regime tributário</label><select class="input" id="dp-crt"><option value="">Selecione…</option><option value="1" ${String(depositProfile.regimeTributario||'')==='1'?'selected':''}>Simples Nacional</option><option value="2" ${String(depositProfile.regimeTributario||'')==='2'?'selected':''}>Simples Nacional · excesso sublimite</option><option value="3" ${String(depositProfile.regimeTributario||'')==='3'?'selected':''}>Regime Normal</option></select></div>
          <div class="field field--full"><label>Logradouro</label><input class="input" id="dp-log" value="${escapeHTML(depositProfile.logradouro||'')}"></div>
          <div class="field"><label>Número</label><input class="input" id="dp-num" value="${escapeHTML(depositProfile.numero||'')}"></div>
          <div class="field"><label>Complemento</label><input class="input" id="dp-comp" value="${escapeHTML(depositProfile.complemento||'')}"></div>
          <div class="field"><label>Bairro</label><input class="input" id="dp-bairro" value="${escapeHTML(depositProfile.bairro||'')}"></div>
          <div class="field"><label>Cidade</label><input class="input" id="dp-cidade" value="${escapeHTML(depositProfile.cidade||'')}"></div>
          <div class="field"><label>UF</label><input class="input" maxlength="2" id="dp-uf" value="${escapeHTML(depositProfile.uf||'')}"></div>
          <div class="field"><label>CEP</label><input class="input" id="dp-cep" value="${escapeHTML(depositProfile.cep||'')}"></div>
          <div class="field"><label>Cód. município IBGE</label><input class="input" id="dp-ibge" value="${escapeHTML(depositProfile.codigoMunicipioIBGE||'')}"></div>
          <div class="field"><label>Telefone</label><input class="input" id="dp-tel" value="${escapeHTML(depositProfile.telefone||'')}"></div>
          <div class="field"><label>E-mail</label><input class="input" id="dp-email" value="${escapeHTML(depositProfile.email||'')}"></div>
        </div>
        <div class="form-actions"><button class="btn btn--primary" id="dp-save">Salvar dados do depósito</button></div>
      </div>

      <div class="card field--full" style="grid-column:1/-1">
        <div class="section-title" style="margin-top:0">Emissão de NF-e</div>
        <p class="hint">A central fiscal já controla documentos e devoluções. Para transmitir uma NF-e válida à SEFAZ, o servidor precisa de um emissor fiscal e certificado digital A1 da empresa.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><span class="pill">Modo: ${escapeHTML(fiscalCapabilities?.mode||'manual')}</span><span class="pill">${fiscalCapabilities?.automaticEmissionConfigured?'✅ Emissor configurado':'⚠️ Emissor ainda não configurado'}</span><span class="pill">Devolução fiscal: pronta para preparação</span></div>
      </div>

      <div class="card field--full" style="grid-column:1/-1">
        <div class="section-title" style="margin-top:0">Resumo do banco de dados</div>
        <div class="grid grid--stats">
          ${counts.map(([name, n]) => statCard(labelStore(name), n, 'navy')).join('')}
        </div>
      </div>
    </div>
  `;

  document.getElementById('dp-save').onclick = async () => {
    const row={id:'deposit_profile',razaoSocial:document.getElementById('dp-razao').value.trim(),nomeFantasia:document.getElementById('dp-fantasia').value.trim(),cnpj:document.getElementById('dp-cnpj').value.replace(/\D/g,''),inscricaoEstadual:document.getElementById('dp-ie').value.trim(),regimeTributario:document.getElementById('dp-crt').value,logradouro:document.getElementById('dp-log').value.trim(),numero:document.getElementById('dp-num').value.trim(),complemento:document.getElementById('dp-comp').value.trim(),bairro:document.getElementById('dp-bairro').value.trim(),cidade:document.getElementById('dp-cidade').value.trim(),uf:document.getElementById('dp-uf').value.trim().toUpperCase(),cep:document.getElementById('dp-cep').value.replace(/\D/g,''),codigoMunicipioIBGE:document.getElementById('dp-ibge').value.replace(/\D/g,''),telefone:document.getElementById('dp-tel').value.trim(),email:document.getElementById('dp-email').value.trim(),atualizadoEm:new Date().toISOString()};
    try{await DB.put('meta',row);toast('Dados do depósito salvos.','success');}catch(e){toast(e.message,'error');}
  };

  document.getElementById('st-export').onclick = exportFullBackup;
  document.getElementById('st-export-sqlite').onclick = () => window.location.href = '/api/backup/sqlite';
  document.getElementById('st-import').addEventListener('change', importFullBackup);
}

function labelStore(name) {
  return { products: 'Produtos', lots: 'Lotes', entries: 'Entradas', exits: 'Saídas', backlog: 'Backlog', losses: 'Avarias', inventories: 'Inventários', history: 'Histórico', fiscalInvoices: 'Notas Fiscais' }[name] || name;
}

async function exportFullBackup() {
  let data;
  try { data = await apiFetch('/backup'); } catch (err) { toast(err.message || 'Não foi possível gerar o backup.', 'error'); return; }
  downloadFile(`backup_lifesucos_${todayISO()}.json`, JSON.stringify(data, null, 2), 'application/json');
  toast('Backup exportado.', 'success');
}

async function importFullBackup(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const ok = await confirmDialog('Restaurar este backup irá SUBSTITUIR todos os dados atuais do servidor. Deseja continuar?');
  if (!ok) return;
  try {
    const data = JSON.parse(await file.text());
    const result = await apiFetch('/restore', { method: 'POST', body: data });
    toast('Backup restaurado com sucesso.', 'success');
    if (result?.requiresRelogin) {
      setTimeout(async () => { try { await fetch('/api/auth/logout', { method:'POST' }); } catch {} location.reload(); }, 900);
    } else {
      setTimeout(() => navigate('dashboard'), 600);
    }
  } catch (err) {
    toast('Arquivo de backup inválido ou erro ao restaurar.', 'error');
  }
}
