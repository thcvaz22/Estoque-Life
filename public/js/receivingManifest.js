/* ============================================================
   RECEIVING MANIFEST — Romaneio de Conferência de Recebimento
   Gera PDF A4 para conferência manual de NF recebida.
   ============================================================ */

function rmMoney(v){return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
function rmText(v){return String(v??'').trim();}
function rmSupplierDoc(s){return s?.cnpjCpf||s?.cnpj||s?.cpf||'';}
function rmAddress(o){
  if(!o)return'';
  return [
    [o.logradouro,o.numero].filter(Boolean).join(', '),
    o.complemento,
    o.bairro,
    [o.cidade,o.uf].filter(Boolean).join(' / '),
    o.cep?`CEP ${o.cep}`:''
  ].filter(Boolean).join(' · ');
}
function rmLogisticsBreakdown(product,units){
  let rest=Math.max(0,Number(units)||0);
  const upf=Math.max(1,Number(product?.unidadesPorFardo||product?.qtdPorEmbalagem||1));
  const fpp=Math.max(0,Number(product?.fardosPorPalete||0));
  const name=product?.nomeFardo||((product?.embalagem||'').toLowerCase()==='bag'?'Caixa':'Fardo');
  const parts=[];
  if(fpp>0){
    const full=upf*fpp;
    const half=full/2;
    const pallets=Math.floor(rest/full+1e-9);
    if(pallets>0){parts.push(`${pallets} pallet${pallets>1?'s':''}`);rest-=pallets*full;}
    if(rest>=half-1e-9 && half>0){parts.push('1/2 pallet');rest-=half;}
  }
  const packs=Math.floor(rest/upf+1e-9);
  if(packs>0){parts.push(`${packs} ${name.toLowerCase()}${packs>1?'s':''}`);rest-=packs*upf;}
  const rounded=Math.round(rest*100)/100;
  if(rounded>0||!parts.length)parts.push(`${rounded} un.`);
  return parts.join(' + ');
}

async function generateReceivingManifest(entryId,{open=true}={}){
  const entry=await DB.get('entries',entryId);
  if(!entry)throw new Error('Entrada não encontrada.');
  const [products,suppliers,deposit]=await Promise.all([DB.all('products'),DB.all('suppliers'),DB.get('meta','deposit_profile')]);
  const supplier=suppliers.find(s=>s.id===entry.fornecedorId)||suppliers.find(s=>String(s.razaoSocial||s.nome||'').trim().toLowerCase()===String(entry.fornecedor||'').trim().toLowerCase())||null;
  if(!window.jspdf?.jsPDF)throw new Error('Biblioteca de PDF ainda não carregou. Aguarde alguns segundos e tente novamente.');
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({unit:'mm',format:'a4'});
  const left=12,right=198;
  const addLine=(y)=>doc.line(left,y,right,y);
  const section=(title,lines,y)=>{
    doc.setFont('helvetica','bold');doc.setFontSize(9);doc.text(title,left,y);
    doc.setFont('helvetica','normal');doc.setFontSize(8);
    let yy=y+4;
    for(const line of lines.filter(Boolean)){doc.text(String(line),left,yy,{maxWidth:right-left});yy+=4;}
    addLine(yy+1);return yy+5;
  };

  doc.setFont('helvetica','bold');doc.setFontSize(15);doc.text('ROMANEIO DE CONFERÊNCIA DE RECEBIMENTO',105,14,{align:'center'});
  doc.setFontSize(8);doc.setFont('helvetica','normal');
  doc.text(`NF: ${entry.nf||'—'}${entry.serie?` · Série ${entry.serie}`:''} · Recebimento: ${fmtDate(entry.data||entry.dataChegada)}`,left,20);
  doc.text(`Responsável pelo lançamento: ${entry.responsavel||'—'} · Páginas/fotos da NF: ${(entry.fotos||[]).length}`,left,24);
  addLine(27);
  let y=32;
  const dep=deposit||{};
  y=section('RECEBEDOR / DEPÓSITO',[
    dep.razaoSocial||dep.nomeFantasia||'Dados do depósito não cadastrados',
    [dep.cnpj?`CNPJ ${dep.cnpj}`:'',dep.inscricaoEstadual?`IE ${dep.inscricaoEstadual}`:''].filter(Boolean).join(' · '),
    rmAddress(dep),
    [dep.telefone,dep.email].filter(Boolean).join(' · ')
  ],y);
  y=section('REMETENTE / FORNECEDOR',[
    supplier?.razaoSocial||supplier?.nome||entry.fornecedor||'Fornecedor não identificado',
    [rmSupplierDoc(supplier)?`CNPJ/CPF ${rmSupplierDoc(supplier)}`:'',supplier?.inscricaoEstadual?`IE ${supplier.inscricaoEstadual}`:''].filter(Boolean).join(' · '),
    rmAddress(supplier),
    [supplier?.telefone,supplier?.email].filter(Boolean).join(' · ')
  ],y);

  const rows=(entry.itens||[]).map(it=>{
    const product=products.find(p=>p.id===it.produtoId)||{};
    const units=Number(it.quantidade||0);
    return [
      fmtNumber(units),
      rmLogisticsBreakdown(product,units),
      productDisplayName(product.id?product:{nome:it.produtoNome||'Produto'}),
      '[   ]'
    ];
  });
  doc.autoTable({
    startY:y,
    head:[['Unidades recebidas','Equivalência caixa / fardo / pallet','Descrição do produto','Conferido']],
    body:rows,
    styles:{font:'helvetica',fontSize:8,cellPadding:2.2,valign:'middle'},
    headStyles:{fillColor:[245,245,245],textColor:[20,20,20],lineColor:[80,80,80],lineWidth:.15},
    bodyStyles:{lineColor:[150,150,150],lineWidth:.12},
    columnStyles:{0:{cellWidth:24,halign:'center'},1:{cellWidth:52},2:{cellWidth:89},3:{cellWidth:20,halign:'center',fontSize:11}},
    margin:{left,right:12}
  });
  y=doc.lastAutoTable.finalY+6;
  const total=Number(entry.valorTotalMercadorias||0)|| (entry.itens||[]).reduce((sum,it)=>sum+(Number(it.valorTotalItem||0)||Number(it.quantidadeInformada||it.quantidade||0)*Number(it.custoUnitario||0)),0);
  doc.setFont('helvetica','bold');doc.setFontSize(10);doc.text(`VALOR TOTAL DAS MERCADORIAS RECEBIDAS: ${rmMoney(total)}`,right,y,{align:'right'});
  y+=6;
  if(y>225){doc.addPage();y=16;}
  doc.setFontSize(9);doc.text('DEVOLUÇÕES / DIVERGÊNCIAS NO RECEBIMENTO',left,y);y+=3;
  doc.rect(left,y,right-left,24);y+=29;
  doc.text('OBSERVAÇÕES',left,y);y+=3;doc.rect(left,y,right-left,18);y+=24;
  if(y>248){doc.addPage();y=18;}
  doc.setFont('helvetica','normal');doc.setFontSize(8);
  doc.text('Nome do motorista: __________________________________________________________________________________',left,y);y+=15;
  const sigY=y;
  const cols=[left,76,140];
  const labels=['Assinatura do motorista','Assinatura do conferente','Assinatura da gerência'];
  labels.forEach((lab,i)=>{doc.line(cols[i],sigY,cols[i]+52,sigY);doc.text(lab,cols[i]+26,sigY+4,{align:'center'});});
  doc.setFontSize(7);doc.text(`Gerado pelo Life Sucos · ${new Date().toLocaleString('pt-BR')}`,105,289,{align:'center'});
  const filename=`Romaneio_Recebimento_NF_${String(entry.nf||entry.id).replace(/[^\w.-]/g,'_')}.pdf`;
  if(open){
    const url=doc.output('bloburl');window.open(url,'_blank','noopener');
  }
  return {doc,filename};
}
