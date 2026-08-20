/* ============================================================
   GLOBAL SEARCH — busca unificada da barra superior.
   Mantido como função pura para permitir teste sem servidor/DB.
   ============================================================ */

function text(value){ return String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
function hit(values, q){ return values.some(v => text(v).includes(q)); }
function digits(value){ return String(value ?? '').replace(/\D/g,''); }

function searchAll({ products=[], customers=[], orders=[], invoices=[], entries=[], exits=[], backlog=[], suppliers=[], lots=[] }={}, term=''){
  const q=text(term).trim();
  const qDigits=digits(term);
  if(q.length<2 && qDigits.length<2) return [];
  const out=[];
  const add=(r)=>out.push(r);

  for(const p of products){
    if(p.ativo===false) continue;
    if(hit([p.codigoInterno,p.nome,p.marca,p.volume,p.embalagem,p.codigoBarras],q) || (qDigits && digits(p.codigoBarras).includes(qDigits))){
      add({type:'product',id:p.id,route:'products',label:`${p.codigoInterno?`${p.codigoInterno} · `:''}${p.nome||'Produto'}`,detail:[p.marca,p.embalagem,p.volume].filter(Boolean).join(' · '),searchKey:[p.codigoInterno,p.nome,p.codigoBarras].filter(Boolean).join(' ')});
    }
  }
  for(const c of customers){
    if(c.ativo===false) continue;
    if(hit([c.nome,c.nomeFantasia,c.razaoSocial,c.cnpj,c.cidade,c.bairro,c.regiao,c.vendedorNome,c.whatsapp,c.email],q) || (qDigits && digits(c.cnpj).includes(qDigits))){
      add({type:'customer',id:c.id,route:'commercialCustomers',label:c.nome||c.nomeFantasia||c.razaoSocial||'Cliente',detail:[c.cnpj,c.cidade,c.bairro,c.vendedorNome].filter(Boolean).join(' · '),searchKey:[c.nome,c.cnpj,c.cidade,c.bairro].filter(Boolean).join(' ')});
    }
  }
  for(const o of orders){
    if(hit([o.numero,o.nfNumero,o.clienteNome,o.vendedorNome,o.formaPagamento,o.status,o.fornecedorNome],q) || (qDigits && [digits(o.numero),digits(o.nfNumero)].some(v=>v&&v.includes(qDigits)))){
      add({type:'order',id:o.id,route:'commercialOrders',label:`Pedido ${o.numero||o.id}`,detail:[o.nfNumero?`NF ${o.nfNumero}`:'',o.clienteNome,o.vendedorNome,o.status].filter(Boolean).join(' · '),searchKey:[o.numero,o.nfNumero,o.clienteNome].filter(Boolean).join(' ')});
    }
  }
  for(const n of invoices){
    if(hit([n.numero,n.serie,n.chaveAcesso,n.clienteNome,n.cnpjCliente,n.pedidoNumero,n.status],q) || (qDigits && [digits(n.numero),digits(n.chaveAcesso),digits(n.pedidoNumero)].some(v=>v&&v.includes(qDigits)))){
      add({type:'invoice',id:n.id,route:'invoices',label:`NF-e ${n.numero||n.id}`,detail:[n.clienteNome,n.pedidoNumero?`Pedido ${n.pedidoNumero}`:'',n.status].filter(Boolean).join(' · '),searchKey:[n.numero,n.chaveAcesso,n.pedidoNumero,n.clienteNome].filter(Boolean).join(' ')});
    }
  }
  for(const e of entries){
    if(hit([e.nf,e.fornecedor,e.chaveNFe,e.responsavel],q) || (qDigits && [digits(e.nf),digits(e.chaveNFe)].some(v=>v&&v.includes(qDigits)))){
      add({type:'entry',id:e.id,route:'entries',label:`Entrada ${e.nf?`NF ${e.nf}`:e.id}`,detail:[e.fornecedor,e.data,e.responsavel].filter(Boolean).join(' · '),searchKey:[e.nf,e.fornecedor,e.chaveNFe].filter(Boolean).join(' ')});
    }
  }
  for(const e of exits){
    const nfs=(e.nfs||[]).map(n=>n.numero).filter(Boolean);
    if(hit([e.cliente,e.motorista,e.placa,e.status,...nfs],q) || (qDigits && nfs.some(n=>digits(n).includes(qDigits)))){
      add({type:'exit',id:e.id,route:'exits',label:`Saída ${nfs.length?`NF ${nfs.join(', ')}`:e.id}`,detail:[e.cliente,e.motorista,e.status].filter(Boolean).join(' · '),searchKey:[...nfs,e.cliente,e.motorista].filter(Boolean).join(' ')});
    }
  }
  for(const b of backlog){
    if(hit([b.nf,b.cliente,b.produtoNome,b.motivo,b.status],q) || (qDigits && digits(b.nf).includes(qDigits))){
      add({type:'backlog',id:b.id,route:'backlog',label:`Backlog ${b.nf?`NF ${b.nf}`:b.id}`,detail:[b.cliente,b.produtoNome,b.status].filter(Boolean).join(' · '),searchKey:[b.nf,b.cliente,b.produtoNome].filter(Boolean).join(' ')});
    }
  }
  for(const s of suppliers){
    if(s.ativo===false) continue;
    if(hit([s.nome,s.razaoSocial,s.cnpj,s.telefone,s.email],q) || (qDigits && digits(s.cnpj).includes(qDigits))){
      add({type:'supplier',id:s.id,route:'entries',label:`Fornecedor · ${s.nome||s.razaoSocial||s.id}`,detail:[s.cnpj,s.telefone].filter(Boolean).join(' · '),searchKey:[s.nome,s.cnpj].filter(Boolean).join(' ')});
    }
  }
  for(const l of lots){
    if(hit([l.lote,l.localizacao],q)){
      const product=products.find(p=>p.id===l.productId);
      add({type:'lot',id:l.id,route:'stock',label:`Lote ${l.lote||l.id}`,detail:[product?.nome,l.localizacao,l.validade].filter(Boolean).join(' · '),searchKey:[l.lote,product?.nome,l.localizacao].filter(Boolean).join(' ')});
    }
  }

  const typeOrder={order:1,invoice:2,customer:3,product:4,entry:5,exit:6,backlog:7,lot:8,supplier:9};
  const exactDigits=(r)=>qDigits && digits(r.searchKey).includes(qDigits) ? 0 : 1;
  return out.sort((a,b)=>exactDigits(a)-exactDigits(b)||(typeOrder[a.type]||99)-(typeOrder[b.type]||99)||String(a.label).localeCompare(String(b.label),'pt-BR')).slice(0,30);
}

module.exports={searchAll};
