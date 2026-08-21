/* ============================================================
   AION IA — assistente operacional do Life Sucos

   Funciona em modo local: interpreta comandos frequentes no servidor
   da empresa, consulta o SQLite e prepara rascunhos/relatórios. Toda
   operação crítica continua exigindo conferência humana e passando
   pelas regras transacionais já existentes.
   ============================================================ */

const AionIA = (() => {
  let open = false;
  let busy = false;
  const conversation = [];

  function ensureUI() {
    if (document.getElementById('aion-ai-fab')) return;
    const app = document.getElementById('app');
    if (!app) return;
    const fab = document.createElement('button');
    fab.id = 'aion-ai-fab';
    fab.className = 'aion-ai-fab';
    fab.type = 'button';
    fab.setAttribute('aria-label', 'Abrir AION IA');
    fab.innerHTML = `<span class="aion-ai-fab__spark">✦</span><span class="aion-ai-fab__text"><strong>AION</strong><small>IA</small></span>`;
    document.body.appendChild(fab);

    const panel = document.createElement('section');
    panel.id = 'aion-ai-panel';
    panel.className = 'aion-ai-panel';
    panel.setAttribute('aria-label', 'AION IA');
    panel.innerHTML = `
      <div class="aion-ai-panel__head">
        <div class="aion-ai-brand">
          <span class="aion-ai-brand__icon">✦</span>
          <div><strong>AION IA</strong><small id="aion-ai-mode">Sistema de Inteligência AION · Conversacional</small></div>
        </div>
        <button class="icon-btn aion-ai-close" type="button" aria-label="Fechar">✕</button>
      </div>
      <form class="aion-ai-compose aion-ai-compose--top" id="aion-ai-form">
        <textarea id="aion-ai-input" rows="2" placeholder="Pergunte sobre operação, vendas, gestão, sistema ou mercado…"></textarea>
        <button type="submit" class="aion-ai-send" aria-label="Enviar">➜</button>
      </form>
      <div class="aion-ai-quick">
        <button data-prompt="Analise minha operação e diga o que devo priorizar hoje">Analisar operação</button>
        <button data-prompt="Como faço uma entrada por foto da NF?">Entrada por foto</button>
        <button data-prompt="Quanto tenho de produtos com estoque zerado?">Estoque crítico</button>
        <button data-prompt="48 unidades do código 100 dão quantos fardos?">Converter embalagens</button>
        <button data-prompt="Faça um benchmarking do mercado de sucos e bebidas, compare com minha operação e recomende as 3 melhores oportunidades">Benchmark</button>
        <button data-prompt="Quais tendências do mercado de sucos e bebidas devo acompanhar?">Mercado</button>
      </div>
      <div class="aion-ai-messages" id="aion-ai-messages"></div>
      <div class="aion-ai-privacy" id="aion-ai-privacy">🔒 Dados internos são analisados com as permissões do seu usuário.</div>`;
    document.body.appendChild(panel);

    fab.addEventListener('click', toggle);
    panel.querySelector('.aion-ai-close').addEventListener('click', () => setOpen(false));
    panel.querySelectorAll('[data-prompt]').forEach(btn => btn.addEventListener('click', () => submitPrompt(btn.dataset.prompt)));
    panel.querySelector('#aion-ai-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = panel.querySelector('#aion-ai-input');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      submitPrompt(text);
    });
    addAssistant(`Olá, ${Auth.currentUser()?.nome || 'tudo bem'}! Pode falar comigo normalmente. Eu conheço o Life Sucos, posso tirar dúvidas sobre qualquer tela ou processo, consultar seus dados, fazer contas e conversões de fardos/caixas/pallets e também analisar a operação.`);
    loadStatus();
  }


  async function loadStatus() {
    try {
      const r=await fetch('/api/aion/status',{cache:'no-store'}); if(!r.ok)return; const d=await r.json();
      const mode=document.getElementById('aion-ai-mode'); const privacy=document.getElementById('aion-ai-privacy');
      if(mode) mode.textContent=d.webSearch?'AION conversacional + web':d.externalAI?'AION conversacional + IA externa':'AION conversacional · local';
      if(privacy) privacy.textContent=d.externalAI?'🔒 Dados internos seguem suas permissões; consultas externas usam contexto minimizado.':'🔒 Inteligência local ativa. A conexão externa pode ser habilitada no servidor.';
    } catch {}
  }

  function setOpen(value) {
    open = value;
    document.getElementById('aion-ai-panel')?.classList.toggle('open', open);
    document.getElementById('aion-ai-fab')?.classList.toggle('active', open);
    if (open) setTimeout(() => document.getElementById('aion-ai-input')?.focus(), 160);
  }
  function toggle() { setOpen(!open); }

  function msgContainer() { return document.getElementById('aion-ai-messages'); }
  function append(kind, html) {
    const wrap = msgContainer(); if (!wrap) return null;
    const el = document.createElement('div');
    el.className = `aion-ai-msg aion-ai-msg--${kind}`;
    el.innerHTML = html;
    wrap.appendChild(el);
    wrap.scrollTop = wrap.scrollHeight;
    return el;
  }
  function addUser(text) { return append('user', `<div>${escapeHTML(text)}</div>`); }
  function addAssistant(text) { return append('assistant', `<div>${escapeHTML(text).replace(/\n/g,'<br>')}</div>`); }
  function addThinking() { return append('assistant thinking', `<div><span></span><span></span><span></span></div>`); }

  async function submitPrompt(text) {
    if (busy) return;
    setOpen(true); addUser(text); const thinking = addThinking(); busy = true;
    try {
      const history=conversation.slice(-10);
      conversation.push({role:'user',content:text});
      const data = await postJSON('/api/aion/ask', { message:text, history });
      thinking?.remove();
      const reply=data.reply || 'Pronto.';
      addAssistant(reply);
      conversation.push({role:'assistant',content:reply});
      if (data.action) renderAction(data.action);
    } catch (err) {
      thinking?.remove();
      addAssistant(`Não consegui concluir agora: ${err.message}`);
    } finally { busy = false; }
  }

  function renderAction(action) {
    if (!action || !action.type) return;
    if (action.type === 'report') return renderReport(action.report);
    if (action.type === 'confirm_master') {
      const label = action.kind === 'customer' ? 'cliente' : 'fornecedor';
      const el = append('action', `<div class="aion-ai-action-card aion-ai-master-card">
        <strong>Confirmar cadastro de ${label}</strong>
        <label>Nome<input class="input ai-master-name" value="${escapeHTML(action.payload?.nome || '')}"></label>
        <div class="aion-ai-master-grid">
          <label>CNPJ (opcional)<input class="input ai-master-cnpj" value="${escapeHTML(action.payload?.cnpj || '')}"></label>
          <label>Telefone (opcional)<input class="input ai-master-phone" value="${escapeHTML(action.payload?.telefone || '')}"></label>
        </div>
        <label>Observações<textarea class="input ai-master-notes" rows="2">${escapeHTML(action.payload?.observacoes || '')}</textarea></label>
        <button class="btn btn--primary aion-ai-confirm-master">Cadastrar ${label}</button>
      </div>`);
      el.querySelector('.aion-ai-confirm-master').onclick = async (e) => {
        const btn=e.currentTarget; btn.disabled=true; btn.textContent='Cadastrando…';
        try {
          const endpoint=action.kind==='customer'?'/api/aion/master/customer':'/api/aion/master/supplier';
          const payload={nome:el.querySelector('.ai-master-name').value.trim(),cnpj:el.querySelector('.ai-master-cnpj').value.trim(),telefone:el.querySelector('.ai-master-phone').value.trim(),observacoes:el.querySelector('.ai-master-notes').value.trim()};
          const result=await postJSON(endpoint, payload);
          addAssistant(result.message || 'Cadastro realizado.'); el.remove();
        } catch(err){ addAssistant(err.message); btn.disabled=false; btn.textContent=`Cadastrar ${label}`; }
      };
      return;
    }
    const actionMap = {
      open_entry: { label:'Abrir Entrada para conferir', icon:'↓', run: async()=>{ setOpen(false); await navigate('entries'); openEntryForm(action.draft||{}); } },
      open_exit: { label:'Abrir Saída/Pedido para conferir', icon:'→', run: async()=>{ setOpen(false); await navigate('exits'); openExitForm(action.draft||{}); } },
      open_loss: { label:'Abrir Avaria/Perda para conferir', icon:'⚠', run: async()=>{ setOpen(false); await navigate('losses'); openLossForm(action.draft||{}); } },
      open_product: { label:'Abrir Cadastro de Produto', icon:'+', run: async()=>{ setOpen(false); await navigate('products'); openProductForm(null,null,action.draft||{}); } }
    };
    const cfg=actionMap[action.type]; if(!cfg) return;
    const el=append('action', `<button class="aion-ai-action-button">${cfg.icon} <span>${escapeHTML(cfg.label)}</span></button>`);
    el.querySelector('button').onclick=cfg.run;
  }

  function renderReport(report) {
    const rows=Array.isArray(report.rows)?report.rows:[];
    const headers=(report.headers||[]).map((label,i)=>({label,key:(report.keys||[])[i]||`c${i}`}));
    const previewRows=rows.slice(0,5);
    const table = rows.length ? `<div class="aion-ai-report-table"><table><thead><tr>${headers.slice(0,4).map(h=>`<th>${escapeHTML(h.label)}</th>`).join('')}</tr></thead><tbody>${previewRows.map(r=>`<tr>${headers.slice(0,4).map(h=>`<td>${escapeHTML(r[h.key] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="hint">Nenhum registro encontrado no período.</p>';
    const el=append('action', `<div class="aion-ai-report-card"><div class="aion-ai-report-title"><span>📄</span><div><strong>${escapeHTML(report.title||'Relatório')}</strong><small>${escapeHTML(report.summary||'')}</small></div></div>${table}<div class="aion-ai-report-actions"><button class="btn btn--primary ai-pdf" ${rows.length?'':'disabled'}>Gerar PDF</button><button class="btn ai-view">Abrir Relatórios</button></div></div>`);
    el.querySelector('.ai-pdf')?.addEventListener('click', () => {
      exportPDF(report.title || 'Relatório AION IA', headers, rows, { subtitle:`Gerado pela AION IA em ${fmtDateTime(new Date().toISOString())} · ${report.summary||''}` });
      addAssistant('PDF gerado. O arquivo foi preparado com os dados filtrados que você solicitou.');
    });
    el.querySelector('.ai-view')?.addEventListener('click', async()=>{ setOpen(false); await navigate('reports'); });
  }

  async function loadCatalogs() {
    try {
      const res=await fetch('/api/aion/catalogs', {cache:'no-store'}); if(!res.ok) return {customers:[],suppliers:[]}; return res.json();
    } catch { return {customers:[],suppliers:[]}; }
  }

  return { init:ensureUI, open:()=>setOpen(true), ask:submitPrompt, loadCatalogs };
})();
