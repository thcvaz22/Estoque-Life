@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>nul
cd /d "%~dp0"
title Life Sucos v18 - Instalar Servidor Hibrido

echo ===========================================================
echo  LIFE SUCOS v18 - AION SYNC / SERVIDOR LOCAL RESILIENTE
echo ===========================================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado.
  echo Instale o Node.js 24 LTS e execute este arquivo novamente.
  pause
  exit /b 1
)

echo [1/4] Instalando/verificando dependencias...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo [ERRO] Falha ao instalar dependencias. Verifique a internet.
  pause
  exit /b 1
)

echo [2/4] Criando atalho da Area de Trabalho...
cscript //nologo "criar-atalho-area-de-trabalho.vbs"

echo [3/4] Configurando inicio automatico do servidor local...
cscript //nologo "configurar-inicio-automatico.vbs"

echo [4/4] Iniciando Life Sucos...
start "" wscript.exe "%~dp0iniciar-app.vbs"

echo.
echo Pronto. Este computador passa a ser o servidor local do deposito.
echo Em Configuracoes ^> AION Sync, pareie-o com a nuvem.
echo.
pause
