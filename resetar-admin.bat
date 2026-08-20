@echo off
setlocal
cd /d "%~dp0"
title Life Sucos - Resetar Admin
if not exist "node_modules\better-sqlite3" (
  echo As dependencias ainda nao estao instaladas. Abra o Life Sucos normalmente primeiro.
  echo.
  pause
  exit /b 1
)
node scripts\reset-admin.js
echo.
pause
