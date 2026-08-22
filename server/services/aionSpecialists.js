/* AION Agent Core 3.0 — roteamento interno por especialidade */
const SPECIALISTS=Object.freeze({
  operacao:{name:'Operações',focus:'fluxo operacional, gargalos, backlog, saídas, romaneios e produtividade'},
  estoque:{name:'Estoque',focus:'saldo, ruptura, cobertura, validade, FEFO, reposição, inventário e perdas'},
  comercial:{name:'Comercial',focus:'pedidos, clientes, vendedores, ticket, conversão, carteira e prioridades de venda'},
  financeiro:{name:'Financeiro',focus:'faturamento, margem, custos, recebimentos, despesas, comissão e resultado'},
  mercado:{name:'Mercado',focus:'concorrentes, tendências, benchmarking, inovação e oportunidades externas'},
  gestao:{name:'Gestão',focus:'KPIs, comparativos, projeções, metas, cenários, riscos, oportunidades e tomada de decisão'}
});
function norm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
function route(message){const q=norm(message),ids=new Set(['gestao']);if(/estoque|produto|ruptura|validade|lote|inventario|perda|avaria|reposi/.test(q))ids.add('estoque');if(/pedido|cliente|vendedor|venda|carteira|ticket|comercial/.test(q))ids.add('comercial');if(/saida|romaneio|motorista|veiculo|backlog|operacao|separacao|produtiv/.test(q))ids.add('operacao');if(/finance|lucro|margem|custo|despesa|receber|pagar|comissao|fatur/.test(q))ids.add('financeiro');if(/mercado|concorrent|benchmark|tendencia|novidade|inovacao|marca/.test(q))ids.add('mercado');return [...ids].map(id=>({id,...SPECIALISTS[id]}));}
function prompt(message){return route(message).map(s=>`${s.name}: ${s.focus}`).join(' | ');}
module.exports={SPECIALISTS,route,prompt};