/* ============================================================
   VIEWS/USERS.JS — gestão de usuários (somente Gerente)

   Usuários nunca são excluídos: são desativados para preservar
   toda a rastreabilidade das movimentações antigas.
   ============================================================ */

async function renderUsers(root) {
  if (!(typeof Auth !== 'undefined' && Auth.isManager && Auth.isManager())) {
    root.innerHTML = `<div class="empty-state"><div class="big">🔒</div><p>Acesso restrito ao perfil Gerente.</p></div>`;
    return;
  }

  const users = await apiFetch('/users');
  const ativos = users.filter(u => u.ativo);
  const gerentes = ativos.filter(u => u.perfil === 'Gerente').length;
  const operadores = ativos.filter(u => u.perfil === 'Operador').length;
  const vendedores = ativos.filter(u => u.perfil === 'Vendedor').length;
  const current = Auth.currentUser();

  root.innerHTML = `
    <div class="view-head">
      <div>
        <p class="subtitle">Cadastre operadores e gerentes, redefina senhas e desative acessos sem apagar o histórico.</p>
      </div>
      <button class="btn btn--primary" id="user-new">+ Novo usuário</button>
    </div>

    <div class="grid grid--stats" style="margin-bottom:16px">
      ${statCard('Usuários ativos', ativos.length, 'navy')}
      ${statCard('Operadores', operadores, 'green')}
      ${statCard('Gerentes', gerentes, 'navy')}
      ${statCard('Vendedores', vendedores, 'citrus')}
      ${statCard('Desativados', users.length - ativos.length, 'red')}
    </div>

    <div class="card" style="margin-bottom:14px">
      <strong>🔐 Regra de acesso</strong>
      <p class="hint" style="margin:6px 0 0">Somente Gerentes podem criar, editar, reativar, desativar usuários ou redefinir senhas. Usuários desativados permanecem no histórico das movimentações.</p>
    </div>

    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>Nome</th><th>Usuário</th><th>Perfil</th><th>Status</th><th>Cadastrado em</th><th>Ações</th></tr></thead>
        <tbody>
          ${users.map(u => `
            <tr class="${u.ativo ? '' : 'row-muted'}">
              <td><strong>${escapeHTML(u.nome)}</strong>${u.id === current?.id ? '<div class="hint">Você</div>' : ''}</td>
              <td class="cell-mono">${escapeHTML(u.username)}</td>
              <td>${statusStamp(u.perfil, u.perfil === 'Gerente' ? 'info' : 'neutral')}</td>
              <td>${statusStamp(u.ativo ? 'Ativo' : 'Desativado', u.ativo ? 'ok' : 'danger')}</td>
              <td class="cell-mono" style="font-size:12px">${u.createdAt ? fmtDateTime(u.createdAt) : '—'}</td>
              <td class="row-actions">
                <button class="btn btn--sm" data-user-edit="${u.id}" ${!u.ativo ? 'disabled' : ''}>Editar</button>
                <button class="btn btn--sm" data-user-password="${u.id}" ${!u.ativo ? 'disabled' : ''}>Senha</button>
                ${u.ativo
                  ? `<button class="btn btn--sm btn--danger" data-user-deactivate="${u.id}" ${u.id === current?.id ? 'disabled title="Você não pode desativar a própria conta"' : ''}>Desativar</button>`
                  : `<button class="btn btn--sm btn--primary" data-user-activate="${u.id}">Reativar</button>`}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('user-new').onclick = () => openUserForm();
  root.querySelectorAll('[data-user-edit]').forEach(btn => btn.onclick = () => openUserForm(users.find(u => u.id === btn.dataset.userEdit)));
  root.querySelectorAll('[data-user-password]').forEach(btn => btn.onclick = () => openPasswordReset(users.find(u => u.id === btn.dataset.userPassword)));
  root.querySelectorAll('[data-user-deactivate]').forEach(btn => btn.onclick = () => deactivateUser(users.find(u => u.id === btn.dataset.userDeactivate)));
  root.querySelectorAll('[data-user-activate]').forEach(btn => btn.onclick = () => activateUser(users.find(u => u.id === btn.dataset.userActivate)));
}

function openUserForm(user = null) {
  const isEdit = !!user;
  openModal(isEdit ? 'Editar usuário' : 'Novo usuário', `
    <div class="form-grid">
      <div class="field field--full">
        <label>Nome</label>
        <input class="input" id="usr-name" maxlength="80" value="${escapeHTML(user?.nome || '')}" placeholder="Ex: João da Silva" autocomplete="off">
      </div>
      <div class="field">
        <label>Usuário / Login</label>
        <input class="input" id="usr-login" maxlength="40" value="${escapeHTML(user?.username || '')}" placeholder="Ex: joao" autocomplete="off">
      </div>
      <div class="field">
        <label>Perfil</label>
        <select class="input" id="usr-profile">
          <option value="Operador" ${!user || user.perfil === 'Operador' ? 'selected' : ''}>Operador</option>
          <option value="Gerente" ${user?.perfil === 'Gerente' ? 'selected' : ''}>Gerente</option>
          <option value="Vendedor" ${user?.perfil === 'Vendedor' ? 'selected' : ''}>Vendedor</option>
        </select>
      </div>
      ${!isEdit ? `
        <div class="field">
          <label>Senha</label>
          <input class="input" type="password" id="usr-password" minlength="6" autocomplete="new-password" placeholder="Mínimo de 6 caracteres">
        </div>
        <div class="field">
          <label>Confirmar senha</label>
          <input class="input" type="password" id="usr-password-confirm" minlength="6" autocomplete="new-password">
        </div>` : `
        <div class="field field--full">
          <p class="hint">A senha não é alterada nesta tela. Use o botão <strong>Senha</strong> na lista para redefini-la.</p>
        </div>`}
    </div>
    <div class="form-actions">
      <button class="btn btn--ghost" id="usr-cancel">Cancelar</button>
      <button class="btn btn--primary" id="usr-save">${isEdit ? 'Salvar alterações' : 'Cadastrar usuário'}</button>
    </div>
  `);

  document.getElementById('usr-cancel').onclick = closeModal;
  const btn = document.getElementById('usr-save');
  btn.onclick = async () => {
    const nome = document.getElementById('usr-name').value.trim();
    const username = document.getElementById('usr-login').value.trim();
    const perfil = document.getElementById('usr-profile').value;
    if (!nome || !username) { toast('Informe nome e usuário.', 'warn'); return; }

    const body = { nome, username, perfil };
    if (!isEdit) {
      const password = document.getElementById('usr-password').value;
      const confirm = document.getElementById('usr-password-confirm').value;
      if (password.length < 6) { toast('A senha deve ter pelo menos 6 caracteres.', 'warn'); return; }
      if (password !== confirm) { toast('As senhas não conferem.', 'warn'); return; }
      body.password = password;
    }

    try {
      await withBusyButton(btn, isEdit ? 'Salvando…' : 'Cadastrando…', () => apiFetch(isEdit ? `/users/${user.id}` : '/users', {
        method: isEdit ? 'PUT' : 'POST', body
      }));
      const editingSelf = isEdit && user.id === Auth.currentUser()?.id;
      closeModal();
      toast(isEdit ? 'Usuário atualizado.' : 'Usuário cadastrado.', 'success');
      if (editingSelf) {
        // Nome/perfil da sessão pode ter mudado; recarregar garante que o menu
        // e o cabeçalho reflitam imediatamente a permissão vigente no servidor.
        setTimeout(() => location.reload(), 500);
      } else {
        navigate('users');
      }
    } catch (err) {
      toast(err.message || 'Não foi possível salvar o usuário.', 'error');
    }
  };
}

function openPasswordReset(user) {
  if (!user) return;
  openModal('Redefinir senha', `
    <p style="margin-bottom:14px">Nova senha para <strong>${escapeHTML(user.nome)}</strong> <span class="cell-mono">(${escapeHTML(user.username)})</span>.</p>
    <div class="form-grid">
      <div class="field">
        <label>Nova senha</label>
        <input class="input" id="pwd-new" type="password" minlength="6" autocomplete="new-password" placeholder="Mínimo de 6 caracteres">
      </div>
      <div class="field">
        <label>Confirmar senha</label>
        <input class="input" id="pwd-confirm" type="password" minlength="6" autocomplete="new-password">
      </div>
    </div>
    <p class="hint">Ao redefinir a senha, as sessões abertas desse usuário serão encerradas por segurança.</p>
    <div class="form-actions">
      <button class="btn btn--ghost" id="pwd-cancel">Cancelar</button>
      <button class="btn btn--primary" id="pwd-save">Redefinir senha</button>
    </div>
  `);
  document.getElementById('pwd-cancel').onclick = closeModal;
  const btn = document.getElementById('pwd-save');
  btn.onclick = async () => {
    const password = document.getElementById('pwd-new').value;
    const confirm = document.getElementById('pwd-confirm').value;
    if (password.length < 6) { toast('A senha deve ter pelo menos 6 caracteres.', 'warn'); return; }
    if (password !== confirm) { toast('As senhas não conferem.', 'warn'); return; }
    try {
      const result = await withBusyButton(btn, 'Redefinindo…', () => apiFetch(`/users/${user.id}/reset-password`, { method: 'POST', body: { password } }));
      closeModal();
      toast('Senha redefinida. As sessões do usuário foram encerradas.', 'success');
      if (result?.selfSessionInvalidated) setTimeout(() => location.reload(), 700);
      else navigate('users');
    } catch (err) {
      toast(err.message || 'Não foi possível redefinir a senha.', 'error');
    }
  };
}

async function deactivateUser(user) {
  if (!user) return;
  const ok = await confirmDialog(`Desativar o acesso de ${user.nome} (${user.username})? O histórico desse usuário será preservado e ele não conseguirá mais entrar até ser reativado.`);
  if (!ok) return;
  try {
    await apiFetch(`/users/${user.id}/deactivate`, { method: 'POST', body: {} });
    toast('Usuário desativado. Histórico preservado.', 'success');
    navigate('users');
  } catch (err) {
    toast(err.message || 'Não foi possível desativar o usuário.', 'error');
  }
}

async function activateUser(user) {
  if (!user) return;
  try {
    await apiFetch(`/users/${user.id}/activate`, { method: 'POST', body: {} });
    toast('Usuário reativado.', 'success');
    navigate('users');
  } catch (err) {
    toast(err.message || 'Não foi possível reativar o usuário.', 'error');
  }
}
