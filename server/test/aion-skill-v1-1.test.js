const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'../..');
const skill=require('../services/aionSkill');
const unified=fs.readFileSync(path.join(root,'server/services/aionUnified.js'),'utf8');
const sales=fs.readFileSync(path.join(root,'seller-public/index.html'),'utf8');
const operational=fs.readFileSync(path.join(root,'public/js/aion-ai.js'),'utf8');

test('AION Skill oficial v1.1 possui quatro papéis obrigatórios',()=>{
  assert.equal(skill.SKILL.version,'1.1');
  assert.equal(skill.SKILL.roles.length,4);
  assert.match(skill.SKILL.principle,/Código calcula\. AION interpreta, questiona e recomenda\./);
});

test('camada unificada implementa análises temporais, projeções e mercado',()=>{
  for(const token of ['momPct','yoyPct','ytdPct','movingAverages','correlation','projections','forceWeb:true','AionSkill.systemInstructions']) assert.match(unified,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('interfaces operacional e vendas expõem benchmarking e Skill 1.1',()=>{
  assert.match(sales,/Skill 1\.1/);assert.match(sales,/Benchmark/);
  assert.match(operational,/Skill 1\.1/);assert.match(operational,/Benchmark/);
});
