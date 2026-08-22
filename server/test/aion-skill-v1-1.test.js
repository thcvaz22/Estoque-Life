const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'../..');
const skill=require('../services/aionSkill');
const unified=fs.readFileSync(path.join(root,'server/services/aionUnified.js'),'utf8');
const agent=fs.readFileSync(path.join(root,'server/aionAgentRoutes.js'),'utf8');
const core=fs.readFileSync(path.join(root,'server/services/aionAgentCore.js'),'utf8');
const dashboardCore=fs.readFileSync(path.join(root,'public/js/aion-agent-core-v30.js'),'utf8');
const sales=fs.readFileSync(path.join(root,'seller-public/index.html'),'utf8');
const operational=fs.readFileSync(path.join(root,'public/js/aion-ai.js'),'utf8');
const screenContext=fs.readFileSync(path.join(root,'public/js/aion-context-v20.js'),'utf8');

test('AION Agent Core 3.0 é contextual, planejador, proativo e executor',()=>{
  assert.equal(skill.SKILL.version,'3.0');
  assert.match(skill.SKILL.core,/Agent Core 3\.0/);
  assert.ok(skill.SKILL.roles.length>=7);
  assert.deepEqual(skill.SKILL.intentModes,['explicar','consultar','analisar','comparar','projetar','recomendar','planejar','executar']);
  assert.match(skill.SKILL.principle,/planeja/i);
  const summary=skill.publicSummary();
  assert.ok(summary.enterpriseMemory);
  assert.ok(summary.agenticPlanning);
  assert.ok(summary.agenticActions);
  assert.ok(summary.proactiveIntelligence);
  assert.ok(summary.interactiveSuggestions);
  assert.ok(summary.evidenceConfidence);
  assert.ok(summary.fallbackOnlyAsContingency);
});

test('AION Skill protege configuração e saúde do provedor externo',()=>{
  assert.ok(Array.isArray(skill.SKILL.providerPolicy));
  assert.ok(skill.SKILL.providerPolicy.length>=8);
  assert.ok(Array.isArray(skill.SKILL.deploymentChecklist));
  const policy=skill.SKILL.providerPolicy.join(' ');
  assert.match(policy,/GEMINI_API_KEY/);assert.match(policy,/GEMINI_MODEL/);assert.match(policy,/gemini-3\.5-flash/);assert.match(policy,/saúde real do provedor/i);assert.match(policy,/não pode gerar resposta genérica/i);
  const summary=skill.publicSummary();assert.ok(summary.providerHealthRequired);assert.ok(summary.providerSpecificModelConfig);assert.ok(summary.externalGroundingRequiredForMarket);
});

test('Agent Core oferece métricas, projeção, memória, plano e sugestões proativas',()=>{
  for(const token of ['projectedNext30','revenueChangePct','saveMemory','memories','function proactive','function plan','confidence','actions'])assert.match(core,new RegExp(token));
  for(const token of ['/api/aion/core/proactive','Ver análise e opções','data-act','askAion','navigate'])assert.match(dashboardCore,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('camada unificada mantém análises temporais, projeções e mercado',()=>{
  for(const token of ['momPct','yoyPct','ytdPct','movingAverages','correlation','projections','forceWeb:true','AionSkill.systemInstructions']) assert.match(unified,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('agente contextual prioriza resposta generativa e recebe contexto da tela',()=>{
  assert.match(agent,/Responda como um analista humano integrado ao sistema/);assert.match(agent,/scope:'sales'/);assert.match(agent,/screenContext/);assert.match(agent,/Core\.memories/);assert.match(agent,/Core\.metrics/);assert.match(screenContext,/currentRoute/);assert.match(screenContext,/\/api\/aion\/ask/);
});

test('interfaces operacional e vendas expõem benchmarking e modo conversacional',()=>{assert.match(sales,/Conversacional/);assert.match(sales,/Benchmark/);assert.match(operational,/Conversacional/);assert.match(operational,/Benchmark/);});