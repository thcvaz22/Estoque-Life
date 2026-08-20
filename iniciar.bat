@echo off
title Life Sucos - Controle de Estoque
chcp 65001 >nul 2>nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERRO] O Node.js nao esta instalado neste computador.
  echo Instale a versao LTS do Node.js e execute novamente.
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node --version 2^>nul') do set "NODE_VERSION=%%v"
for /f "tokens=1 delims=." %%m in ("%NODE_VERSION:v=%") do set "NODE_MAJOR=%%m"
if %NODE_MAJOR% LSS 22 (
  echo.
  echo [ERRO] Esta versao do Life Sucos requer Node.js 22, 24 ou 26.
  echo Recomendado neste computador: Node.js 24 LTS.
  pause
  exit /b 1
)
if %NODE_MAJOR% GEQ 27 (
  echo.
  echo [ERRO] Esta versao do Node.js ainda nao foi homologada.
  echo Use Node.js 24 LTS para maior compatibilidade.
  pause
  exit /b 1
)

node -e "require('express');require('better-sqlite3');require('tesseract.js')" >nul 2>nul
if errorlevel 1 (
  echo.
  echo Primeira execucao ou dependencias incompletas - preparando o sistema...
  echo Isso pode levar alguns minutos e normalmente acontece uma unica vez.
  echo.
  if exist "node_modules\better-sqlite3" rmdir /s /q "node_modules\better-sqlite3" >nul 2>nul
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo [ERRO] Falha ao instalar as dependencias.
    echo Verifique sua conexao com a internet e tente novamente.
    pause
    exit /b 1
  )
)

echo.
set "PORT=4000"
set "HTTPS_PORT=4443"
echo Iniciando o Life Sucos na porta dedicada %PORT%...
echo Para PARAR o sistema, feche esta janela.
echo O navegador nao e aberto por este arquivo; para a experiencia de
echo aplicativo, use o atalho "Life Sucos" da Area de Trabalho.
echo.
call npm start

pause
