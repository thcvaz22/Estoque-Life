# Life Sucos v16.3 — Deploy seguro no Render

## Arquitetura de implantação

Para a implantação de produção, a v16.3 mantém a camada operacional que já foi validada no SQLite síncrono e transacional. No Render, o SQLite fica obrigatoriamente no disco persistente `/var/data`. O Neon recebe um espelho assíncrono do estado do sistema em intervalos de 5 minutos.

Isso evita uma troca apressada da lógica crítica de estoque/FEFO/reservas antes da implantação. O corte definitivo para PostgreSQL Neon como banco operacional principal será realizado na v17.

## Render Blueprint

O repositório precisa conter `render.yaml` na raiz. No Render:

1. New → Blueprint.
2. Conecte o GitHub e escolha `thcvaz22/Estoque-Life`.
3. Branch: `main`.
4. Blueprint path: `render.yaml`.
5. Preencha os segredos solicitados no painel:
   - `DATABASE_URL` — string de conexão pooled do Neon.
   - `OPENAI_API_KEY` — chave da OpenAI, criada na plataforma e mantida somente no servidor.
   - `BOOTSTRAP_ADMIN_PASSWORD` — senha forte de primeiro acesso da nuvem.
6. Revise e faça o Deploy Blueprint.

O Blueprint já cria um disco persistente de 1 GB montado em `/var/data`, configura backups e ativa o espelho Neon.

## Validação após deploy

Abra `/api/health`. O retorno esperado deve conter:

- `ok: true`
- `systemVersion: 16.3.0-cloud-stable-neon-mirror-aion-1.1`
- `storage: sqlite-persistent-disk+neon-mirror`
- `neonMirror.enabled: true`

Depois valide login, sistema operacional e `/vendas/`.
