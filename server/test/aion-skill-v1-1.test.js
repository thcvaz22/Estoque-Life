const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'../..');
const skill=require('../services/aionSkill');
const unified=fs.readFileSync(path.join(root,'server/services/aionUnified.js'),'utf8');
const sales=fs.readFileSync(path.join(root,'seller-public/index.html'),'utf8');
const operational=fs.readFileSync(path.join(root,'public/js/aion-ai.js'),'utf8');

test('AION Skill oficial v1.2 possui papéis conversacionais obrigatórios',()=>{
  assert.equal(skill.SKILL.version,'1.2');
  assert.ok(skill.SKILL.roles.length>=5);
  assert.match(skill.SKILL.principle,/AION entende, conversa, interpreta e resolve/);
  assert.ok(skill.publicSummary().humanizedInteraction);
  assert.ok(skill.publicSummary().businessCalculator);
});

test('camada unificada implementa análises temporais, projeções e mercado',()=>{
  for(const token of ['momPct','yoyPct','ytdPct','movingAverages','correlation','projections','forceWeb:true','AionSkill.systemInstructions']) assert.match(unified,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('interfaces operacional e vendas expõem benchmarking e modo conversacional',()=>{
  assert.match(sales,/Conversacional/);assert.match(sales,/Benchmark/);
  assert.match(operational,/Conversacional/);assert.match(operational,/Benchmark/);
});
