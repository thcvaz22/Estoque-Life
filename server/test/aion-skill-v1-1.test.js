const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'../..');
const skill=require('../services/aionSkill');
const unified=fs.readFileSync(path.join(root,'server/services/aionUnified.js'),'utf8');
const agent=fs.readFileSync(path.join(root,'server/aionAgentRoutes.js'),'utf8');
const sales=fs.readFileSync(path.join(root,'seller-public/index.html'),'utf8');
const operational=fs.readFileSync(path.join(root,'public/js/aion-ai.js'),'utf8');
const screenContext=fs.readFileSync(path.join(root,'public/js/aion-context-v20.js'),'utf8');

test('AION Skill oficial 2.0 é contextual, agentiva e conversacional',()=>{
  assert.equal(skill.SKILL.version,'2.0');
  assert.ok(skill.SKILL.roles.length>=5);
  assert.deepEqual(skill.SKILL.intentModes,['explicar','consultar','analisar','comparar','recomendar','executar']);
  assert.match(skill.SKILL.principle,/entende o contexto/i);
  const summary=skill.publicSummary();
  assert.ok(summary.humanizedInteraction);
  assert.ok(summary.dynamicContext);
  assert.ok(summary.agenticActions);
  assert.ok(summary.businessCalculator);
  assert.ok(summary.fallbackOnlyAsContingency);
});

test('camada unificada mantém análises temporais, projeções e mercado',()=>{
  for(const token of ['momPct','yoyPct','ytdPct','movingAverages','correlation','projections','forceWeb:true','AionSkill.systemInstructions']) assert.match(unified,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('agente contextual prioriza resposta generativa e recebe contexto da tela',()=>{
  assert.match(agent,/Responda como um analista humano integrado ao sistema/);
  assert.match(agent,/scope:'sales'/);
  assert.match(agent,/screenContext/);
  assert.match(screenContext,/currentRoute/);
  assert.match(screenContext,/\/api\/aion\/ask/);
});

test('interfaces operacional e vendas expõem benchmarking e modo conversacional',()=>{
  assert.match(sales,/Conversacional/);assert.match(sales,/Benchmark/);
  assert.match(operational,/Conversacional/);assert.match(operational,/Benchmark/);
});
