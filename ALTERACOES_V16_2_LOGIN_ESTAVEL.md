# Life Sucos v16.2 — Login estável

## Correção

A v15/v16 passou a gerar senha administrativa aleatória em primeira instalação local. Isso era seguro, mas prejudicou o fluxo de implantação e fez instalações novas parecerem com login quebrado.

A v16.2 separa os cenários:

- **Instalação local:** mantém os acessos conhecidos da operação (`admin/adminlife2026` e `operador/life2026`).
- **Nuvem/Render:** continua exigindo senha definida por segredo de ambiente ou, na ausência, credencial aleatória protegida.
- **Banco local recém-criado por v15/v16.0/v16.1:** recuperação automática, uma única vez, quando detectado o arquivo de primeiro acesso e base ainda nova.
- **Banco já em uso:** usuários existentes não são sobrescritos automaticamente.
- **Recuperação manual:** `recuperar-login.bat` restaura somente os acessos locais padrão e preserva estoque, clientes, pedidos e histórico.

## Cache e portas

- Novo cache PWA para impedir carregamento de frontend antigo.
- HTTP local: 4000.
- HTTPS local: 4443.
- Diagnóstico atualizado para testar health + login.

## AION / Neon

A AION Official Skill v1.1 permanece ativa e a compatibilidade com a migração Neon v16 é preservada.
