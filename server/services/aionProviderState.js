let last={configured:false,ok:null,checkedAt:null,error:null};
function markConfigured(v){last={...last,configured:!!v};}
function success(){last={...last,configured:true,ok:true,checkedAt:new Date().toISOString(),error:null};}
function failure(err){last={...last,configured:true,ok:false,checkedAt:new Date().toISOString(),error:String(err||'Falha no provedor').slice(0,300)};}
function snapshot(){return {...last};}
module.exports={markConfigured,success,failure,snapshot};
