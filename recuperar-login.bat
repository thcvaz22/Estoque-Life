@echo off
setlocal
cd /d "%~dp0"
title Life Sucos v16.2 - Recuperar Login
if not exist "node_modules\better-sqlite3" (
  echo As dependencias ainda nao estao instaladas. Abra o Life Sucos normalmente primeiro.
  echo.
  pause
  exit /b 1
)
echo ================================================
echo LIFE SUCOS v16.2 - RECUPERACAO DE LOGIN LOCAL
echo ================================================
echo.
echo Este processo NAO apaga estoque, clientes, pedidos ou historico.
echo Ele restaura apenas os acessos locais padrao.
echo.
node scripts\repair-local-login.js
echo.
pause
