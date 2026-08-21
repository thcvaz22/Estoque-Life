# Life Sucos v18.0 — AION Sync / Operação Híbrida

## Objetivo

Eliminar a dependência operacional de um único servidor de nuvem.

- O **depósito usa o servidor local como primário operacional**.
- O **Render/Neon continuam atendendo vendedores e acesso remoto**.
- Se internet/Render cair, o depósito continua trabalhando.
- Se o vendedor ficar sem nuvem/rede, novos **pedidos e clientes** ficam na fila IndexedDB do aparelho.
- Quando a conexão volta, a sincronização ocorre automaticamente.
- Operações com conflito **não são descartadas**: ficam pendentes para revisão.

## Primeira instalação — ordem obrigatória

1. Publicar primeiro a v18 no GitHub/Render.
2. No computador que será o servidor do depósito, manter os dados locais existentes e instalar a v18.
3. Executar `instalar-servidor-hibrido.bat` uma única vez.
4. Na versão em nuvem: Configurações → AION Sync → **Gerar código de pareamento**.
5. No servidor local: Configurações → AION Sync → informar URL da nuvem + código.
6. Escolher a fonte da primeira sincronização:
   - **Usar ESTE servidor local como base** quando ele contém os dados reais da empresa.
   - **Usar os dados da NUVEM** somente quando a nuvem já contém a base correta.
7. Configurar, se possível, uma pasta de backup secundária em outro disco/NAS/rede.

> A v18 cria backups dos dois lados antes da carga inicial para reduzir o risco de uma escolha equivocada.

## Funcionamento durante falhas

### Render ou internet da empresa indisponível

O depósito continua no servidor local. Cada mutação fica registrada no SQLite persistente, na outbox e no journal redundante. Ao voltar a nuvem, as operações são reproduzidas com idempotência e o estado consolidado retorna ao local.

### Vendedor sem conexão

O app Life Vendas precisa ter sido aberto e autenticado online ao menos uma vez. A última sessão conhecida pode operar offline por até 24h. Novos pedidos/clientes são gravados no IndexedDB e enviados automaticamente na volta da conexão.

O estoque mostrado offline é a última fotografia conhecida; por isso o pedido só é considerado confirmado após sincronização com o servidor.

### Conflito de estoque

A realidade física do depósito tem prioridade para movimentos físicos sincronizados. Se uma saída/avaria feita durante a queda deixar reservas comerciais maiores que o estoque, o sistema mantém os pedidos e cria alerta de conflito para revisão. Nenhum pedido é apagado automaticamente.

## Proteções da v18

- `SQLite WAL + synchronous=FULL` no servidor local.
- Outbox persistente.
- Journal NDJSON com `fsync` para recuperação de operações ainda não enviadas.
- Idempotência de replay persistida no Neon por meio da tabela de operações existente.
- Token de pareamento de 48 bytes; na nuvem fica somente SHA-256 do token.
- Código de pareamento expira em 10 minutos e bloqueia após tentativas inválidas.
- Anexos de NF/XML/PDF são sincronizados.
- Backups de snapshot antes de reconciliações e carga inicial.
- Backup secundário opcional para outro disco/NAS/pasta de rede.
- Pedidos/clientes offline do vendedor usam `clientOperationId` para evitar duplicação em retry.

## Teste de homologação recomendado

1. Fazer uma entrada pequena com tudo online.
2. Desconectar a internet do servidor local.
3. Fazer outra entrada/avaria de teste no depósito.
4. Em um vendedor já autenticado, colocar o celular em modo avião e criar um pedido de teste.
5. Confirmar que ambos mostram operações pendentes.
6. Reativar a conexão.
7. Aguardar AION Sync zerar as pendências.
8. Conferir no estoque, histórico, pedidos e Neon que cada operação entrou uma única vez.
9. Repetir com uma saída que provoque deliberadamente conflito de reserva para conferir o alerta.

## Limite físico inevitável

Nenhum sistema pode garantir perda zero se o próprio aparelho que contém o único dado ainda não sincronizado for fisicamente destruído antes de haver uma segunda cópia. A v18 reduz esse risco com journal, backups e opção de pasta secundária. Para operação crítica, configure o backup secundário em outro equipamento/disco e use nobreak no servidor local.
