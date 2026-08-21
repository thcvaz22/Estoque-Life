# Life Sucos | AION — v18.2

Ecossistema operacional da Life Sucos com estoque, recebimento, fornecedores, vendas, devoluções, central fiscal, relatórios e Sistema de Inteligência AION.

## Arquitetura atual

- Node.js + Express no backend.
- Render Free hospeda a aplicação online.
- Neon PostgreSQL é a persistência durável/autoritativa no modo nuvem.
- SQLite no Render é somente cache transacional efêmero, reconstruído do Neon a cada inicialização.
- No modo local, SQLite continua persistente na pasta `data/` como contingência.
- PWA operacional + Life Vendas.

## v17.2 — Recebimento, fornecedores e devoluções

### Recebimento de NF

- Importação por XML ou por uma ou várias imagens da NF.
- NF com duas ou mais páginas pode ser fotografada/importada em sequência.
- Entrada registra fornecedor, número/série, valor total, itens, custo, lote e validade.
- Após registrar a entrada, o sistema gera o **Romaneio de Conferência de Recebimento** em PDF.
- O romaneio contém dados do depósito, dados do fornecedor, unidades recebidas, equivalência em caixa/fardo/pallet, descrição, campo manual de conferência, valor total, devoluções/divergências, observações e assinaturas.

### Fornecedores

- Nova aba **Fornecedores**.
- Cadastro de razão social, fantasia, CNPJ/CPF, IE, contato e endereço completo.
- Fornecedor cadastrado é reutilizado em entradas, romaneios e devoluções.
- XML de NF-e pode preencher os dados e, para Gerente, oferecer salvamento rápido do fornecedor identificado.

### Devoluções a fornecedor

- Nova aba **Devoluções**, integrada às avarias já registradas.
- A avaria já representa a baixa de estoque; preparar a devolução **não faz uma segunda baixa**.
- O sistema vincula a devolução à NF de origem, fornecedor, produtos, quantidades e valor estimado.
- Gerente pode preparar/cancelar o rascunho e vincular depois a NF-e de devolução autorizada, com XML e DANFE.

### Fiscal

A v17.2 **não inventa nem simula autorização da SEFAZ**. A Central Fiscal armazena NF-e e permite vincular uma NF-e de devolução já autorizada. A emissão automática requer um provedor fiscal real, certificado A1 e configuração tributária validada.

O código já deixa a arquitetura preparada para um provedor (recomendação de integração: Focus NFe), mas `FISCAL_PROVIDER=manual` deve permanecer enquanto a homologação fiscal não estiver concluída.

## Dados do depósito / emitente

Em **Configurações → Dados do depósito / emitente**, cadastre razão social, CNPJ, IE, endereço, município/UF, CEP, código IBGE, telefone e e-mail. Esses dados alimentam o romaneio de recebimento e serão usados na futura emissão fiscal.

## Atalho Windows

`iniciar-app.bat` inicia o servidor local resiliente do depósito. A operação local continua disponível mesmo durante indisponibilidade de internet, Render ou Neon, e o AION Sync replica as mutações quando a conexão retorna.

O Render e o Neon atendem a operação em nuvem e o acesso dos vendedores pelo Life Vendas, compondo a arquitetura híbrida com o servidor local do depósito.

## Segurança de primeiro acesso

Em banco novo na nuvem:

- `BOOTSTRAP_ADMIN_USERNAME` define o usuário inicial.
- `BOOTSTRAP_ADMIN_PASSWORD` deve ser configurada diretamente no Render.
- `AUTH_SIGNING_SECRET` é gerado pelo Render.
- Nunca grave `DATABASE_URL`, chaves OpenAI, tokens fiscais ou certificados no GitHub.

## Nuvem — Render + Neon

O `render.yaml` usa Render Free sem disco. No boot, o estado durável é restaurado do Neon para o cache SQLite. Em uma escrita, a API só retorna sucesso após a persistência no Neon ser confirmada. Fotos, XMLs e PDFs gerenciados são persistidos no Neon.

Variáveis principais:

```text
CLOUD_MODE=true
CLOUD_PERSISTENCE_MODE=neon-primary
DATABASE_URL=<segredo Neon>
BOOTSTRAP_ADMIN_PASSWORD=<segredo>
AUTH_SIGNING_SECRET=<gerado pelo Render>
```

## AION Online

```text
AION_EXTERNAL_AI_ENABLED=true
AION_WEB_SEARCH_ENABLED=true
AION_MODEL=gpt-5-mini
OPENAI_API_KEY=<segredo>
```

## Fiscal — futura emissão automática

Enquanto não houver homologação:

```text
FISCAL_PROVIDER=manual
```

Quando o provedor for implantado, token/certificado ficam exclusivamente no ambiente seguro do servidor. Antes de produção, validar com a contabilidade os dados de emitente, NCM, CFOP de devolução, CST/CSOSN, PIS/COFINS/IPI e regras tributárias aplicáveis.

## Testes

```bash
npm test
```

O pacote v17.2 passou por verificação de sintaxe de todos os JavaScripts e pelo teste puro do catálogo. A suíte de integração completa precisa ser executada em ambiente com as dependências instaladas.

### Relatórios de Romaneios (v17.2)
Na aba **Relatórios**, a opção **Romaneios** reúne documentos de **Entrada** e **Saída**. É possível filtrar o histórico e clicar em **Emitir / PDF** para gerar novamente o romaneio de conferência de recebimento ou abrir o romaneio de separação/expedição já salvo.


## v18.0 — AION Sync / Operação Híbrida

O depósito opera no servidor local mesmo quando internet, Render ou nuvem estão indisponíveis. As mutações locais entram em uma fila persistente e são reproduzidas na nuvem com idempotência quando a conexão retorna. O Life Vendas mantém cache e fila IndexedDB para novos pedidos/clientes offline. Conflitos são preservados para revisão, nunca descartados silenciosamente.

## v18.1 — Vendedores e carteiras iniciais

A v18.1 pré-cadastra 5 vendedores e 284 clientes extraídos dos relatórios de último pedido enviados em 20/08/2026. O login do vendedor aceita o nome completo ou o usuário normalizado. Os clientes importados entram como `pre_cadastro`, com vendedor responsável e `ultimaCompra`, mas permanecem bloqueados para pedidos até a complementação dos dados e aprovação/classificação.

O Life Vendas também ganhou **Minha conta → Trocar senha**. A troca exige a senha atual, confirmação da nova senha e conexão com o servidor. Em operação híbrida local, a alteração entra na fila AION Sync de usuários para chegar à nuvem; em nuvem, a escrita é confirmada no Neon antes da resposta.
