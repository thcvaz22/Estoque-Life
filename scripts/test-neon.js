const { neonHealth } = require('../server/neon');
(async()=>{
  try{
    const result=await neonHealth();
    console.log(JSON.stringify(result,null,2));
    process.exit(result.ok?0:1);
  }catch(e){
    console.error('Falha ao conectar no Neon:', e.message);
    process.exit(1);
  }
})();
