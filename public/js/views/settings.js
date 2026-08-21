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
  const syncStockConflicts = await DB.get('meta','aion_sync_stock_conflicts') || null;
  let fiscalCapabilities = null;
  try { fiscalCapabilities = await fiscalFetch('/capabilities'); } catch (e) { /* módulo fiscal opcional */ }
  let syncStatus = null;
  try { syncStatus = await apiFetch('/sync/status'); } catch (e) { /* AION Sync pode ainda não estar configurado */ }
  let syncConflicts = [];
  if (!health?.cloudMode && Number(syncStatus?.counts?.conflict||0)>0) { try { syncConflicts = await apiFetch('/sync/local/conflicts'); } catch {} }

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


      <div class="card field--full" style="grid-column:1/-1;border:1px solid rgba(32,102,71,.22)">
        <div class="section-title" style="margin-top:0">AION Sync · Operação Híbrida</div>
        ${syncStockConflicts?.conflicts?.length?`<div class="notice" style="margin-bottom:12px;border-color:var(--alert)"><strong>⚠️ Conflito entre estoque físico e reservas comerciais</strong><br>${syncStockConflicts.conflicts.map(c=>`${escapeHTML(c.produtoNome)}: físico ${c.fisico} · reservado ${c.reservado} · falta ${c.falta}`).join('<br>')}<br><span class="hint">Nenhum pedido foi apagado. Revise os pedidos afetados antes de aprovar/separar.</span></div>`:''}
        ${health?.cloudMode ? `
          <p class="hint">Este é o servidor em nuvem. Gere um código temporário para parear o servidor local do depósito. O código expira em 10 minutos.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <span class="pill">☁️ Nuvem ativa</span>
            <span class="pill">Servidores locais pareados: ${syncStatus?.devices?.length||0}</span>
            <button class="btn btn--primary" id="sync-pair-code">Gerar código de pareamento</button>
          </div>
          <div id="sync-code-result" style="margin-top:10px"></div>
          ${syncStatus?.devices?.length?`<div class="table-wrap" style="margin-top:12px"><table class="data"><thead><tr><th>Dispositivo</th><th>Pareado</th><th>Último contato</th></tr></thead><tbody>${syncStatus.devices.map(d=>`<tr><td>${escapeHTML(d.nome||d.deviceId)}</td><td>${fmtDateTime(d.pairedAt)}</td><td>${d.lastSeenAt?fmtDateTime(d.lastSeenAt):'Ainda não sincronizou'}</td></tr>`).join('')}</tbody></table></div>`:''}
        ` : `
          <p class="hint">O depósito continua operando neste servidor mesmo sem internet. Quando a nuvem volta, as operações pendentes são sincronizadas automaticamente e o estado consolidado volta para o servidor local.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
            <span class="pill">🏢 Servidor local</span>
            <span class="pill">${syncStatus?.paired?'🔗 Pareado com a nuvem':'⚠️ Ainda não pareado'}</span>
            <span class="pill">Pendentes: ${(syncStatus?.counts?.pending||0)+(syncStatus?.counts?.retry||0)}</span>
            <span class="pill">Conflitos: ${syncStatus?.counts?.conflict||0}</span>
            <span class="pill">Última sincronização: ${syncStatus?.lastSyncAt?fmtDateTime(syncStatus.lastSyncAt):'—'}</span>
          </div>
          ${syncStatus?.paired?`${syncStatus?.initialSyncRequired?`
            <div class="notice" style="margin-bottom:10px"><strong>Primeira sincronização ainda não definida.</strong><br>Escolha qual instalação contém os dados que devem ser preservados. Esta decisão evita que uma base de teste substitua os dados reais.</div>
            <div class="form-actions" style="justify-content:flex-start;gap:8px;flex-wrap:wrap">
              <button class="btn btn--primary" id="sync-initial-local">Usar ESTE servidor local como base</button>
              <button class="btn" id="sync-initial-cloud">Usar os dados da NUVEM</button>
            </div>
          `:`
            <div class="form-actions" style="justify-content:flex-start"><button class="btn btn--primary" id="sync-run-now">Sincronizar agora</button></div>
          `}
            ${syncStatus?.lastError?`<div class="notice" style="margin-top:10px">⚠️ ${escapeHTML(syncStatus.lastError)}</div>`:''}
            ${syncConflicts.length?`<div class="table-wrap" style="margin-top:12px"><table class="data"><thead><tr><th>Quando</th><th>Operação</th><th>Motivo</th><th></th></tr></thead><tbody>${syncConflicts.map(c=>`<tr><td>${fmtDateTime(c.createdAt)}</td><td class="cell-mono">${escapeHTML(c.method)} ${escapeHTML(c.path)}</td><td>${escapeHTML(c.lastError||'Conflito')}</td><td><button class="btn btn--sm" data-sync-retry="${escapeHTML(c.id)}">Tentar novamente</button></td></tr>`).join('')}</tbody></table></div>`:''}
          `:`
            <div class="form-grid form-grid--3">
              <div class="field field--full"><label>URL do Life Sucos na nuvem</label><input class="input" id="sync-cloud-url" value="${escapeHTML(syncStatus?.cloudUrl||'https://life-sucos-aion.onrender.com')}"></div>
              <div class="field"><label>Nome deste servidor</label><input class="input" id="sync-device-name" value="${escapeHTML(syncStatus?.deviceName||'Servidor Life Local')}"></div>
              <div class="field"><label>Código de 6 dígitos</label><input class="input" id="sync-pair-input" inputmode="numeric" maxlength="6" placeholder="000000"></div>
            </div>
            <div class="form-actions"><button class="btn btn--primary" id="sync-pair-local">Parear servidor local</button></div>
          `}
          <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line)">
            <div class="field"><label>Backup secundário opcional</label><input class="input" id="sync-secondary-dir" value="${escapeHTML(syncStatus?.secondaryBackupDir||'')}" placeholder="Ex.: D:\Backup-Life ou \\SERVIDOR\Backup-Life"><span class="hint">Recomendado: outro disco, NAS ou pasta de rede. O banco diário e o journal de operações também serão copiados para esse local.</span></div>
            <button class="btn btn--sm" id="sync-save-local-config">Salvar pasta de backup</button>
          </div>
        `}
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


  const saveLocalSyncCfg=document.getElementById('sync-save-local-config');
  if(saveLocalSyncCfg) saveLocalSyncCfg.onclick=async()=>{
    try{await apiFetch('/sync/local/config',{method:'POST',body:{secondaryBackupDir:document.getElementById('sync-secondary-dir').value.trim()}});toast('Configuração local do AION Sync salva.','success');setTimeout(()=>navigate('settings'),400);}catch(e){toast(e.message,'error');}
  };

  const pairCodeBtn=document.getElementById('sync-pair-code');
  if(pairCodeBtn) pairCodeBtn.onclick=async()=>{
    try{
      const r=await apiFetch('/sync/pairing-code',{method:'POST',body:{}});
      const box=document.getElementById('sync-code-result');
      box.innerHTML=`<div class="card" style="padding:14px;background:rgba(255,246,196,.55)"><span class="hint">Digite este código no servidor local:</span><div class="cell-mono" style="font-size:30px;font-weight:800;letter-spacing:8px;margin-top:4px">${escapeHTML(r.code)}</div><span class="hint">Expira em ${fmtDateTime(r.expiresAt)}</span></div>`;
    }catch(e){toast(e.message,'error');}
  };
  const pairLocalBtn=document.getElementById('sync-pair-local');
  if(pairLocalBtn) pairLocalBtn.onclick=async()=>{
    try{
      const r=await apiFetch('/sync/local/pair',{method:'POST',body:{cloudUrl:document.getElementById('sync-cloud-url').value.trim(),deviceName:document.getElementById('sync-device-name').value.trim(),code:document.getElementById('sync-pair-input').value.trim()}});
      toast('Servidor local pareado com a nuvem.','success');setTimeout(()=>navigate('settings'),600);
    }catch(e){toast(e.message,'error');}
  };
  const syncInitialLocal=document.getElementById('sync-initial-local');
  if(syncInitialLocal) syncInitialLocal.onclick=async()=>{
    const ok=await confirmDialog('Usar este servidor local como base irá enviar os dados locais atuais para a nuvem. Use esta opção quando o computador do depósito contém os dados reais. Deseja continuar?');
    if(!ok)return;
    syncInitialLocal.disabled=true;syncInitialLocal.textContent='Enviando dados locais…';
    try{await apiFetch('/sync/local/initial-sync',{method:'POST',body:{direction:'local_to_cloud'}});toast('Carga inicial enviada à nuvem com sucesso.','success');setTimeout(()=>navigate('settings'),700);}catch(e){toast(e.message,'error');syncInitialLocal.disabled=false;syncInitialLocal.textContent='Usar ESTE servidor local como base';}
  };
  const syncInitialCloud=document.getElementById('sync-initial-cloud');
  if(syncInitialCloud) syncInitialCloud.onclick=async()=>{
    const ok=await confirmDialog('Usar a nuvem como base irá substituir os dados operacionais deste servidor local pelos dados atuais da nuvem. Use apenas se a nuvem já contém os dados corretos. Deseja continuar?');
    if(!ok)return;
    syncInitialCloud.disabled=true;syncInitialCloud.textContent='Baixando dados da nuvem…';
    try{await apiFetch('/sync/local/initial-sync',{method:'POST',body:{direction:'cloud_to_local'}});toast('Dados da nuvem aplicados ao servidor local.','success');setTimeout(()=>location.reload(),700);}catch(e){toast(e.message,'error');syncInitialCloud.disabled=false;syncInitialCloud.textContent='Usar os dados da NUVEM';}
  };

  document.querySelectorAll('[data-sync-retry]').forEach(btn=>btn.onclick=async()=>{
    try{await apiFetch(`/sync/local/conflicts/${encodeURIComponent(btn.dataset.syncRetry)}/retry`,{method:'POST',body:{}});toast('Operação marcada para nova tentativa.','success');setTimeout(()=>navigate('settings'),400);}catch(e){toast(e.message,'error');}
  });

  const syncNowBtn=document.getElementById('sync-run-now');
  if(syncNowBtn) syncNowBtn.onclick=async()=>{
    syncNowBtn.disabled=true;syncNowBtn.textContent='Sincronizando…';
    try{await apiFetch('/sync/local/run',{method:'POST',body:{}});toast('Sincronização concluída.','success');setTimeout(()=>navigate('settings'),500);}catch(e){toast(e.message,'error');syncNowBtn.disabled=false;syncNowBtn.textContent='Sincronizar agora';}
  };

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
