# Deploy do Life Sucos v15 na nuvem

## 1. GitHub
Mantenha o código no repositório `Estoque-Life`. Não envie `data/`, `.env`, bancos SQLite ou chaves.

## 2. Render
No Render, crie um **Blueprint** a partir do repositório e use o `render.yaml` da raiz.

O Blueprint usa:
- Web Service Node.js (`starter`)
- disco persistente de 1 GB em `/var/data`
- `LIFESUCOS_DATA_DIR=/var/data`
- backup automático do SQLite

Preencha no painel do Render as variáveis marcadas como segredo:
- `BOOTSTRAP_ADMIN_PASSWORD`
- `OPENAI_API_KEY`

## 3. AION Online
Com `OPENAI_API_KEY` preenchida, a AION passa a usar a OpenAI Responses API. A pesquisa web fica habilitada por `AION_WEB_SEARCH_ENABLED=true`.

## 4. Migrar os dados atuais
Na instalação local:
1. Configurações → Backup completo → Exportar backup (.json).

Na instalação em nuvem:
1. Login com o admin de primeiro acesso.
2. Configurações → Restaurar backup.
3. Se o backup for v6, usuários e hashes de senha também são restaurados.
4. O sistema encerra sessões antigas e solicita novo login.

## 5. Contingência
O SQLite fica no disco persistente do serviço. O Life Sucos também cria cópias íntegras automáticas em `/var/data/backups` e mantém a retenção configurada em `BACKUP_RETENTION_DAYS`.
