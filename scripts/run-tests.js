const { spawnSync } = require('child_process');
const env = {
  ...process.env,
  BOOTSTRAP_ADMIN_USERNAME: process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin',
  BOOTSTRAP_ADMIN_PASSWORD: process.env.BOOTSTRAP_ADMIN_PASSWORD || 'TestAdmin-v15-Only',
  BOOTSTRAP_OPERATOR_USERNAME: process.env.BOOTSTRAP_OPERATOR_USERNAME || 'operador',
  BOOTSTRAP_OPERATOR_PASSWORD: process.env.BOOTSTRAP_OPERATOR_PASSWORD || 'TestOperator-v15-Only'
};
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1'], { stdio: 'inherit', env });
process.exit(r.status ?? 1);
