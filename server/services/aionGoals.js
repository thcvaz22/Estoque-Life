/* AION Agent Core 3.0 — objetivos empresariais persistentes */
const { Data }=require('../db');
function docs(){try{return Data.all('aion_goals')||[];}catch{return [];}}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function list(){return docs().slice().sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt)));}
function create(req,{title,description='',metric='manual',targetValue=null,currentValue=0,dueDate=null}={}){
  if(!String(title||'').trim())throw new Error('Informe o objetivo.');
  const id=`aiongoal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`,now=new Date().toISOString(),target=num(targetValue),current=num(currentValue)??0;
  const row={id,title:String(title).trim().slice(0,160),description:String(description||'').slice(0,1500),metric:String(metric||'manual').slice(0,80),targetValue:target,currentValue:current,dueDate:dueDate?String(dueDate).slice(0,10):null,status:'ativo',createdAt:now,updatedAt:now,createdBy:req?.authUser?.id||null};
  Data.upsert('aion_goals',id,row);return enrich(row);
}
function enrich(g){const target=num(g.targetValue),current=num(g.currentValue)??0;const progress=target&&target!==0?Math.max(0,Math.min(200,(current/target)*100)):null;return {...g,progressPct:progress};}
function update(id,patch={}){const old=docs().find(x=>x.id===id);if(!old)throw new Error('Objetivo não encontrado.');const allowed=['title','description','metric','targetValue','currentValue','dueDate','status'];const next={...old};for(const k of allowed)if(Object.prototype.hasOwnProperty.call(patch,k))next[k]=patch[k];next.updatedAt=new Date().toISOString();Data.upsert('aion_goals',id,next);return enrich(next);}
function summary(){return list().filter(g=>g.status!=='concluido'&&g.status!=='cancelado').slice(0,10).map(enrich);}
module.exports={list:()=>list().map(enrich),create,update,summary};