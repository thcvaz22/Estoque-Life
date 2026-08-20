# Life Sucos v17 — Deploy no Render Free + Neon

## Arquitetura

- Render Web Service: plano Free, sem disco persistente.
- Neon PostgreSQL: persistência autoritativa da operação.
- SQLite na instância: cache transacional efêmero, reconstruído do Neon a cada boot.
- AION Online: OpenAI Responses API + web search quando `OPENAI_API_KEY` estiver configurada.

## Antes do deploy

1. O schema base v16 deve existir no Neon.
2. A migration v17 deve criar a tabela `attachments` para fotos, XML e PDF.
3. Para levar dados reais do PC atual, execute a migração SQLite → Neon antes de trocar a operação para a URL pública.
4. Preserve a pasta/banco local como contingência até a homologação final.

## Render Blueprint

No Render: **New → Blueprint** e conecte o repositório `thcvaz22/Estoque-Life`, branch `main`.
O arquivo `render.yaml` usa `plan: free` e não cria disco.

Segredos solicitados no primeiro Blueprint:

- `DATABASE_URL`: connection string do Neon.
- `OPENAI_API_KEY`: chave OpenAI do backend (pode ser ativada na etapa da AION Online).
- `BOOTSTRAP_ADMIN_PASSWORD`: senha de primeiro acesso se o Neon ainda não tiver usuários.

`AUTH_SIGNING_SECRET` é gerado automaticamente pelo Render e não deve ser commitado.

## Validação mínima

Após o deploy, abra `/api/health` e confirme:

- `ok: true`
- `systemVersion: 17.0.0-neon-primary-render-free-aion-1.1`
- `storage: neon-primary+ephemeral-sqlite-cache`
- `cloudPersistence.enabled: true`
- `cloudPersistence.lastFlushAt` preenchido

Depois valide login, produtos, estoque, entradas, pedidos, romaneio, saídas, clientes, NF, anexos e Life Vendas.
