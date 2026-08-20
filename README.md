# Life Sucos | AION — v17.1

Ecossistema de operação, estoque, vendas remotas, notas fiscais, relatórios e Sistema de Inteligência AION.

## Arquitetura

- Node.js + Express
- SQLite (`better-sqlite3`)
- PWA operacional e Life Vendas
- Modo local para Windows
- Modo nuvem preparado para Render
- Banco SQLite em disco persistente `/var/data` no modo nuvem
- Backups automáticos íntegros do SQLite
- AION IA opcionalmente conectada à OpenAI Responses API com pesquisa web

## Segurança de primeiro acesso

A v15 não possui senha administrativa fixa no código.

Em banco novo:

- `BOOTSTRAP_ADMIN_USERNAME` define o usuário inicial (padrão: `admin`).
- `BOOTSTRAP_ADMIN_PASSWORD` deve ser configurada no ambiente de produção.
- Se a senha não for informada em uma instalação local, o sistema gera uma senha aleatória e grava em `data/PRIMEIRO_ACESSO_ADMIN.txt`.

Instalações que já possuem banco mantêm os usuários e senhas existentes.

## Rodar localmente

```bash
npm install
npm start
```

Portas padrão v16.2:

- HTTP: `4000`
- HTTPS local: `4443`
- Life Vendas: `http://localhost:4000/vendas/`

No Windows, também é possível usar `iniciar-app.vbs`.

## Nuvem — Render

O arquivo `render.yaml` cria um Web Service com disco persistente em `/var/data`.

Variáveis importantes:

```text
CLOUD_MODE=true
LIFESUCOS_DATA_DIR=/var/data
BACKUP_RETENTION_DAYS=30
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=<segredo>
```

Nunca grave senhas ou chaves reais no repositório.

## AION conectada à Internet

Configure no servidor:

```text
AION_EXTERNAL_AI_ENABLED=true
AION_WEB_SEARCH_ENABLED=true
AION_MODEL=gpt-5-mini
OPENAI_API_KEY=<segredo>
```

A chave fica apenas no backend. A AION usa respostas locais para dados internos e pode usar a API externa para raciocínio complementar e pesquisa atual de mercado. Dados internos sensíveis não são enviados como listas completas para pesquisa web; o contexto externo recebe apenas informações agregadas quando necessário.

## Migrar o banco atual para a nuvem

1. Na instalação local, entre como Gerente.
2. Abra **Configurações → Backup completo**.
3. Exporte o **backup JSON**.
4. Abra a instalação em nuvem.
5. Entre com o admin de primeiro acesso configurado no Render.
6. Em **Configurações**, restaure o backup JSON.
7. O backup v6 também leva os usuários e hashes de senha, portanto os logins atuais são preservados. Sessões antigas não são copiadas.
8. Após a restauração, faça login novamente.

O backup SQLite também pode ser baixado para contingência, mas o fluxo JSON é o método recomendado para migração entre instalações.

## Dados que não devem ir para o GitHub

O `.gitignore` exclui:

- `data/`
- bancos `.db/.sqlite/.sqlite3`
- `.env` e variações
- chaves `.key`
- `node_modules/`
- logs

## Testes

```bash
npm test
```

Os testes usam credenciais de fixture próprias e não correspondem às credenciais de produção.

## Publicar no GitHub pelo Windows

Se a conexão do GitHub no ChatGPT estiver apenas em modo leitura, use `publicar-github.bat`. O script usa o Git instalado no computador e o fluxo normal de autenticação do GitHub/Git Credential Manager; nenhuma senha ou token fica gravado no projeto.

## v16 — PostgreSQL Neon (migração em andamento)

A v16 inicia a migração do banco SQLite para PostgreSQL Neon. O pacote inclui conexão PostgreSQL, teste de saúde do Neon, migrador de dados SQLite → Neon e `render.yaml` preparado para receber `DATABASE_URL` como segredo.

A migração está sendo feita em etapas para preservar as regras críticas de estoque, FEFO, reservas, pedidos, usuários e auditoria. Não descarte o banco SQLite atual até a validação final do PostgreSQL.

## v16.2 — AION Official Skill v1.1

O Life Sucos e o Life Vendas agora usam o padrão oficial AION Skill v1.1. A inteligência combina especialista contextual, analista empresarial avançado, inteligência de mercado/benchmarking e copiloto operacional. O princípio é: **Código calcula. AION interpreta, questiona e recomenda.**

A camada analítica passou a produzir comparações MoM/YoY/YTD, médias móveis 3/6/12 meses, tendência, anomalias, correlação e projeções 1/3/6/12 meses em cenários conservador/base/otimista. Quando a OpenAI + web search estiver ativa, análises gerenciais também incorporam benchmarking externo e tendências atuais do setor.

## v16.2 — correção de login para implantação

A instalação local volta a aceitar `admin / adminlife2026` e `operador / life2026`. O modo nuvem mantém credenciais secretas por variável de ambiente. Se uma base recém-criada por v15/v16.0/v16.1 estiver presa com senha aleatória, a v16.2 faz uma recuperação compatível uma única vez; também existe `recuperar-login.bat`, que não apaga dados operacionais.

## v16.3 — Cloud estável para implantação

Antes do primeiro deploy em produção, a arquitetura foi endurecida para evitar perda de dados: o backend operacional ainda usa SQLite síncrono e transacional, portanto em nuvem ele **exige** um disco persistente em `/var/data`. O `render.yaml` já declara esse disco. Se alguém tentar iniciar o sistema em modo nuvem sem `LIFESUCOS_DATA_DIR`, o servidor falha de propósito em vez de gravar em filesystem efêmero.

O Neon fica ativo nesta versão como **espelho assíncrono de segurança**, atualizado automaticamente em intervalos de 5 minutos quando `DATABASE_URL` estiver configurada. Isso permite validar Neon em produção sem trocar, às pressas, a camada transacional de estoque/FEFO/reservas. O corte definitivo para PostgreSQL como banco operacional principal será feito na v17 após a implantação estar estável.


## v17 — Render Free + Neon Primary

A v17 remove a dependência de disco persistente pago no Render. Em nuvem, o Neon PostgreSQL é a fonte persistente/autoritativa. A instância Node mantém um SQLite efêmero apenas como cache transacional para preservar as regras síncronas já validadas de FEFO, estoque e idempotência.

No boot, o estado é restaurado Neon → cache. Em cada operação de escrita, a resposta de sucesso só é enviada depois de o estado resultante ser confirmado no Neon. Exclusões também são sincronizadas. Fotos de NF/romaneio, XML e PDF são persistidos na tabela `attachments` do Neon.

O `render.yaml` usa `plan: free`, não cria disco e gera `AUTH_SIGNING_SECRET` automaticamente. Os segredos `DATABASE_URL`, `OPENAI_API_KEY` e `BOOTSTRAP_ADMIN_PASSWORD` continuam fora do GitHub.

O modo local continua funcionando com SQLite persistente na pasta `data/` como contingência.

## v17.1 — identificação de produtos por volume

O catálogo e os fluxos operacionais passaram a exibir o volume diretamente no nome do produto em mililitros. A padronização é aplicada automaticamente aos produtos oficiais existentes sem alterar IDs, códigos ou vínculos de estoque. O seletor de vínculo manual de entrada mostra código, descrição, volume e embalagem para reduzir erros entre apresentações do mesmo sabor.
