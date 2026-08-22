const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'../..');
const agent=fs.readFileSync(path.join(root,'server/aionAgentRoutes.js'),'utf8');
const local=fs.readFileSync(path.join(root,'server/services/aionLocalContext.js'),'utf8');
test('AION Skill 2.0 não usa apresentação genérica como fallback do agente',()=>{assert.match(agent,/AionLocalContext\.answer/);assert.match(agent,/providerResponded:false/);assert.doesNotMatch(local,/Pode perguntar do seu jeito/)});
