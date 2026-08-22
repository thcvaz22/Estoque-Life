/* ============================================================
   AION LOCAL CONTEXT — contingência inteligente da Skill 2.0
   Usada somente quando o provedor generativo não responde.
   Evita respostas genéricas e mantém a conversa ancorada no sistema.
   ============================================================ */

function norm(v){
  return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
}

function routeHint(screen){
  const route=String(screen?.route||'').trim();
  const title=String(screen?.title||'').trim();
  return title||route||'';
}

function answer({message,scope='operational',screen=null,history=[]}={}){
  const q=norm(message);
  const current=routeHint(screen);
  const previous=Array.isArray(history)?history.slice(-4).map(x=>String(x?.content||'')).filter(Boolean):[];

  if(/senha|trocar senha|alterar senha|mudar senha/.test(q)){
    if(scope==='sales') return {
      reply:'No Life Vendas, abra **Minha conta → Trocar senha**. Informe a senha atual, digite a nova senha duas vezes e salve. Depois da alteração, entre novamente com a nova senha.',
      source:'local-context'
    };
    return {
      reply:'No sistema operacional, a senha dos usuários é administrada em **Usuários** por um perfil Gerente. Abra **Menu → Usuários**, escolha o usuário e use a opção de redefinir senha. Para vendedores, a troca da própria senha fica no **Life Vendas → Minha conta → Trocar senha**.',
      source:'local-context'
    };
  }

  if(/emitir.*nf|emitir.*nota|gerar.*nf|nova.*nf|nota fiscal|nf-e|nfe/.test(q)) return {
    reply:'Hoje o Life trabalha a NF-e autorizada pelo fluxo fiscal configurado. Na aba **Notas Fiscais** você consegue registrar/vincular a NF ao pedido, visualizar DANFE, XML e 2ª via. A emissão automática de uma NF nova só pode acontecer quando o provedor fiscal e o certificado estiverem homologados; o sistema não deve simular autorização da SEFAZ. O fluxo correto é **Pedido aprovado → emissão/autorização fiscal → NF vinculada → Separação/Romaneio → Saída**.',
    source:'local-context'
  };

  if(/veiculo|veículo|placa/.test(q)) return {
    reply:'Os veículos são cadastrados na tela **Separação** pelo botão **Cadastrar veículo**. Depois, ao gerar o romaneio, você seleciona o veículo cadastrado; a placa é preenchida automaticamente e a Saída é criada no mesmo fluxo.',
    source:'local-context'
  };

  if(/romaneio|separacao|separação/.test(q)) return {
    reply:'Na **Separação**, selecione as NFs/pedidos da carga e avance para os dados da saída. Informe motorista, veículo cadastrado, placa, horário e, se necessário, ajudante/observações. Ao confirmar, o sistema gera o romaneio e cria automaticamente a **Saída**, consumindo a reserva do pedido sem baixar o estoque duas vezes.',
    source:'local-context'
  };

  if(/onde|aonde|qual tela|como acesso|como abrir|onde fica/.test(q)){
    const modules=scope==='sales'
      ? 'Painel, Clientes, Novo pedido, Pedidos, Relatórios, Minha conta e AION IA'
      : 'Dashboard, Produtos, Entradas, Saídas, Backlog, Estoque, Inventário, Avarias/Perdas, Clientes, Pedidos, Separação, Notas Fiscais, Relatórios, Usuários e Configurações';
    return {
      reply:`Não encontrei um atalho exato para essa frase, mas consigo te direcionar pelo sistema. Os módulos disponíveis aqui são: ${modules}.${current?` Você está atualmente em **${current}**.`:''} Diga o nome da função que quer usar que eu indico o caminho e o que acontece depois.`,
      source:'local-context'
    };
  }

  if(current) return {
    reply:`Entendi sua pergunta dentro do contexto da tela **${current}**. Neste momento a conexão generativa não respondeu, então não vou inventar uma resposta. Posso continuar com os dados e regras locais dessa tela; reformule em uma frase o que você quer descobrir ou executar e eu direciono pelo fluxo correto.`,
    source:'local-context'
  };

  if(previous.length) return {
    reply:'Estou acompanhando o assunto da conversa, mas a camada generativa não respondeu agora. Em vez de repetir uma apresentação genérica, vou manter o contexto: posso continuar a partir da última pergunta usando os dados e regras locais do Life. Diga só qual parte você quer aprofundar.',
    source:'local-context'
  };

  return {
    reply:'A camada generativa não respondeu agora. Ainda consigo consultar dados do Life, explicar telas e processos e executar os fluxos autorizados. Faça a pergunta normalmente; quando houver uma regra ou dado interno disponível, eu respondo diretamente com base nele.',
    source:'local-context'
  };
}

module.exports={answer};
