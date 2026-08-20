const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const css = fs.readFileSync(path.join(root,'seller-public/style.css'),'utf8');
const html = fs.readFileSync(path.join(root,'seller-public/index.html'),'utf8');
const app = fs.readFileSync(path.join(root,'seller-public/app.js'),'utf8');
const routes = fs.readFileSync(path.join(root,'server/commercialRoutes.js'),'utf8');
const unified = fs.readFileSync(path.join(root,'server/services/aionUnified.js'),'utf8');
const operational = fs.readFileSync(path.join(root,'public/js/aion-ai.js'),'utf8');

test('login do Life Vendas fica isolado e some quando hidden', () => {
  assert.match(css, /\.login\[hidden\].*display:none !important/s);
  assert.match(css, /body\.seller-auth-mode #app\{display:none !important\}/);
  assert.match(css, /body\.seller-app-mode \.login\{display:none !important\}/);
  assert.match(html, /<body class="seller-auth-mode">/);
  assert.match(app, /function showApp\(\)/);
  assert.match(app, /document\.body\.classList\.add\('seller-app-mode'\)/);
});

test('Life Vendas usa o mesmo padrão visual AION do operacional', () => {
  for (const token of ['aion-ai-fab','aion-ai-panel','aion-ai-panel__head','aion-ai-brand','aion-ai-compose','aion-ai-send','aion-ai-close']) {
    assert.match(html, new RegExp(token));
    assert.match(operational, new RegExp(token));
  }
  assert.match(html, /aion-ai-compose aion-ai-compose--top/);
  assert.match(operational, /aion-ai-compose aion-ai-compose--top/);
  assert.match(html, /id="aionClose"/);
});

test('AION comercial e operacional compartilham camada unificada', () => {
  assert.match(routes, /require\('\.\/services\/aionUnified'\)/);
  assert.match(routes, /AionUnified\.howTo\(raw,'sales'\)/);
  assert.match(routes, /AionUnified\.unifiedFallback/);
  assert.match(unified, /function howTo\(/);
  assert.match(unified, /function dataAnswer\(/);
  assert.match(unified, /function managementInsight\(/);
  assert.match(unified, /async function externalAnswer/);
});

test('AION possui análise gerencial e conexão externa opcional', () => {
  assert.match(unified, /AION_EXTERNAL_AI_ENABLED/);
  assert.match(unified, /AION_WEB_SEARCH_ENABLED/);
  assert.match(unified, /https:\/\/api\.openai\.com\/v1\/responses/);
  assert.match(unified, /type:'web_search'/);
  assert.match(unified, /Visão AION/);
  assert.match(html, /Analise minha gestão e diga o que devo priorizar hoje/);
  assert.match(html, /tendências do mercado de sucos e bebidas/i);
});

test('campo de pergunta aparece antes das sugestões no painel', () => {
  assert.ok(html.indexOf('id="aionForm"') < html.indexOf('class="aion-ai-quick"'));
  assert.ok(operational.indexOf('id="aion-ai-form"') < operational.indexOf('class="aion-ai-quick"'));
});
