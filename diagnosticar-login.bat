@echo off
setlocal
chcp 65001 >nul 2>nul
title Life Sucos - Diagnostico de Login v16.2

echo ================================================
echo LIFE SUCOS - DIAGNOSTICO DE LOGIN v16.2
echo ================================================
echo.
echo [1/2] Verificando servidor local na porta 4000...
curl.exe -s -S http://localhost:4000/api/health
echo.
echo.
echo [2/2] Testando login local do gerente...
curl.exe -s -S -X POST http://localhost:4000/api/auth/login -H "Content-Type: application/json" -d "{\"username\":\"admin\",\"password\":\"adminlife2026\"}"
echo.
echo.
echo Se aparecer "ok":true nos dois testes, o login esta funcionando.
echo Se o login falhar, execute recuperar-login.bat e tente novamente.
echo.
pause
