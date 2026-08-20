const { createDatabaseBackup } = require('../server/cloudBackup');
createDatabaseBackup('manual').then(file=>{
  console.log('Backup criado com sucesso em:');
  console.log(file);
}).catch(err=>{
  console.error('Falha ao criar backup:',err.message);
  process.exit(1);
});
