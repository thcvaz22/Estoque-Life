/* Catálogo padrão Life Sucos e regras logísticas de conversão. */
const PRODUCTS = [
  ['100','Suco de Laranja','Garrafa','300 ml'], ['101','Néctar de Uva','Garrafa','300 ml'], ['102','Néctar de Maracujá','Garrafa','300 ml'], ['103','Néctar de Goiaba','Garrafa','300 ml'], ['104','Limonada','Garrafa','300 ml'], ['106','Néctar de Caju','Garrafa','300 ml'], ['107','Néctar de Tangerina','Garrafa','300 ml'],
  ['700','Suco de Laranja','Garrafa','900 ml'], ['701','Néctar de Uva','Garrafa','900 ml'], ['702','Néctar de Maracujá','Garrafa','900 ml'], ['703','Néctar de Goiaba','Garrafa','900 ml'], ['704','Limonada','Garrafa','900 ml'], ['706','Néctar de Caju','Garrafa','900 ml'], ['707','Néctar de Tangerina','Garrafa','900 ml'],
  ['920','Suco de Laranja','Galão','1,5 L'], ['921','Néctar de Uva','Galão','1,5 L'], ['922','Néctar de Maracujá','Galão','1,5 L'], ['923','Néctar de Goiaba','Galão','1,5 L'], ['926','Néctar de Caju','Galão','1,5 L'], ['927','Néctar de Tangerina','Galão','1,5 L'],
  ['620','Suco de Laranja','Galão','2,5 L'],
  ['420','Suco de Laranja','Galão','3,5 L'], ['421','Néctar de Uva','Galão','3,5 L'], ['422','Néctar de Maracujá','Galão','3,5 L'], ['423','Néctar de Goiaba','Galão','3,5 L'], ['425','Néctar de Laranja','Galão','3,5 L'], ['426','Néctar de Caju','Galão','3,5 L'],
  ['300','Suco de Laranja','Bag','5 L'], ['301','Néctar de Uva','Bag','5 L'], ['302','Néctar de Maracujá','Bag','5 L'], ['303','Néctar de Goiaba','Bag','5 L'], ['304','Limonada','Bag','5 L'], ['305','Néctar de Laranja','Bag','5 L'], ['306','Néctar de Caju','Bag','5 L'], ['307','Néctar de Tangerina','Bag','5 L']
];

function logisticsFor(volume, embalagem) {
  const v = String(volume).toLowerCase().replace(/\s/g, '');
  if (embalagem === 'Bag') return { unidadesPorFardo: 7, fardosPorPalete: 25, nomeFardo: 'Caixa' };
  if (v === '300ml') return { unidadesPorFardo: 24, fardosPorPalete: 140, nomeFardo: 'Fardo' };
  if (v === '900ml') return { unidadesPorFardo: 12, fardosPorPalete: 84, nomeFardo: 'Fardo' };
  if (v === '1,5l' || v === '1.5l') return { unidadesPorFardo: 6, fardosPorPalete: 108, nomeFardo: 'Fardo' };
  if (v === '2,5l' || v === '2.5l') return { unidadesPorFardo: 4, fardosPorPalete: 60, nomeFardo: 'Fardo' };
  if (v === '3,5l' || v === '3.5l') return { unidadesPorFardo: 4, fardosPorPalete: 48, nomeFardo: 'Fardo' };
  return { unidadesPorFardo: 1, fardosPorPalete: null, nomeFardo: 'Fardo' };
}

function volumeToMl(volume) {
  const raw = String(volume || '').trim().toLowerCase().replace(',', '.');
  const compact = raw.replace(/\s+/g, '');
  let m = compact.match(/^(\d+(?:\.\d+)?)ml$/i);
  if (m) return Math.round(Number(m[1]));
  m = compact.match(/^(\d+(?:\.\d+)?)l$/i);
  if (m) return Math.round(Number(m[1]) * 1000);
  return null;
}

function productNameWithVolume(nome, volume) {
  const clean = String(nome || '').trim();
  const ml = volumeToMl(volume);
  if (!clean || !ml) return clean;
  // Remove uma medida já existente no fim do nome (300 ml, 1,5 L etc.)
  // e reaplica tudo em ml. Assim a função é idempotente e o catálogo fica
  // consistente em entradas, saídas e pedidos.
  const base = clean.replace(/\s+\d+(?:[.,]\d+)?\s*(?:ml|l)\s*$/i, '').trim();
  return `${base} ${ml} ml`;
}

function makeCatalog(now = new Date().toISOString()) {
  return PRODUCTS.map(([codigoInterno, nome, embalagem, volume]) => {
    const lg = logisticsFor(volume, embalagem);
    const sabor = nome.replace(/^Suco de /, '').replace(/^Néctar de /, '').replace(/^Limonada$/, 'Limão');
    const volumeMl = volumeToMl(volume);
    return {
      id: `life_${codigoInterno}`,
      codigoInterno,
      codigoBarras: '',
      nome: productNameWithVolume(nome, volume),
      marca: 'Life',
      sabor,
      volume,
      volumeMl,
      embalagem,
      unidadeBase: 'Unidade',
      nomeFardo: lg.nomeFardo,
      qtdPorEmbalagem: lg.unidadesPorFardo,
      unidadesPorFardo: lg.unidadesPorFardo,
      fardosPorPalete: lg.fardosPorPalete,
      estoqueMinimo: 0,
      localizacao: '',
      ativo: true,
      criadoEm: now
    };
  });
}

function normalizeMovementUnit(unit) {
  const u = String(unit || 'Unidade').trim().toLowerCase();
  if (['unidade','un','und'].includes(u)) return 'Unidade';
  if (['fardo','fd','caixa','cx'].includes(u)) return 'Fardo';
  if (['palete','pallet','pal'].includes(u)) return 'Pallet';
  if (['meio palete','meio pallet','1/2 pallet','1/2 palete','meio-pallet','meio-palete'].includes(u)) return 'Meio Pallet';
  return unit || 'Unidade';
}

function movementFactor(product, unit) {
  const normalized = normalizeMovementUnit(unit);
  const unitsPerFardo = Number(product.unidadesPorFardo || product.qtdPorEmbalagem || 1);
  const fardosPerPallet = Number(product.fardosPorPalete || 0);
  if (normalized === 'Unidade') return 1;
  if (normalized === 'Fardo') return unitsPerFardo;
  if (normalized === 'Pallet') {
    if (!fardosPerPallet) throw new Error(`Produto ${product.nome} não possui fardos/caixas por pallet configurados.`);
    return unitsPerFardo * fardosPerPallet;
  }
  if (normalized === 'Meio Pallet') {
    if (!fardosPerPallet) throw new Error(`Produto ${product.nome} não possui fardos/caixas por pallet configurados.`);
    return unitsPerFardo * fardosPerPallet / 2;
  }
  throw new Error(`Unidade de movimentação não reconhecida: ${unit}`);
}

function toBaseUnits(product, quantity, unit) {
  const q = Number(quantity);
  if (!Number.isFinite(q) || q <= 0) throw new Error('Quantidade inválida.');
  return q * movementFactor(product, unit);
}

module.exports = { makeCatalog, logisticsFor, volumeToMl, productNameWithVolume, normalizeMovementUnit, movementFactor, toBaseUnits };
