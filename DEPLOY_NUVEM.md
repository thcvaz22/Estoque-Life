# Life Sucos v17.2 — Deploy no Render Free + Neon

## Arquitetura

- Render Web Service: plano Free, sem disco persistente.
- Neon PostgreSQL: persistência durável/autoritativa.
- SQLite da instância: cache transacional efêmero, reconstruído do Neon no boot.
- AION Online: opcional, via chave de API configurada apenas no Render.

## Deploy

Conecte o Blueprint ao repositório `thcvaz22/Estoque-Life`, branch `main`. O `render.yaml` permanece sem disco e com `plan: free`.

Segredos importantes no Render:

- `DATABASE_URL` — conexão do Neon.
- `BOOTSTRAP_ADMIN_PASSWORD` — senha inicial quando aplicável.
- `OPENAI_API_KEY` — opcional para AION Online.
- `AUTH_SIGNING_SECRET` — gerado pelo Render.

Não coloque segredos no GitHub.

## Validação da v17.2

Após o deploy, abra `/api/health` e confirme:

- `ok: true`
- `systemVersion: 17.2.0-neon-primary-render-free-recebimento-fiscal-aion-1.1`
- `storage: neon-primary+ephemeral-sqlite-cache`
- persistência cloud habilitada e sem erro de flush.

Depois valide: login, fornecedores, entrada com 2 imagens, geração do romaneio PDF, entrada no estoque, avaria, rascunho de devolução, cancelamento do rascunho e vínculo manual de NF-e autorizada.

## Fiscal

A v17.2 deve ficar com `FISCAL_PROVIDER=manual` até a integração fiscal ser homologada. O módulo de devoluções prepara os dados e permite registrar a NF-e autorizada, mas **não transmite para SEFAZ** nesta versão.

Para ativar emissão automática, a próxima etapa deve configurar um provedor fiscal real, certificado A1, ambiente de homologação e regras fiscais validadas pela contabilidade.

## Atalho Windows

O `iniciar-app.bat` abre a URL online. `iniciar.bat` permanece como modo local explícito/contingência.
