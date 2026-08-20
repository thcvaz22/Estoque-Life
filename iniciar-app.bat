@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul 2>nul
cd /d "%~dp0"

set "LOGDIR=%~dp0logs"
set "LAUNCHLOG=%LOGDIR%\inicializador.log"
if not exist "%LOGDIR%" mkdir "%LOGDIR%" >nul 2>nul

>>"%LAUNCHLOG%" echo.
>>"%LAUNCHLOG%" echo ============================================================
>>"%LAUNCHLOG%" echo [%date% %time%] Iniciando Life Sucos...

rem ============================================================
rem 1) Confere Node.js.
rem ============================================================
where node >nul 2>nul
if errorlevel 1 (
  >>"%LAUNCHLOG%" echo Node.js nao encontrado.
  call :showerror "O Node.js nao esta instalado. Instale a versao LTS do Node.js e tente novamente."
  exit /b 1
)

for /f "tokens=*" %%v in ('node --version 2^>nul') do set "NODE_VERSION=%%v"
>>"%LAUNCHLOG%" echo Node encontrado: !NODE_VERSION!

rem Life Sucos homologado para Node.js 22 a 26. O computador atual usa Node 24 LTS.
for /f "tokens=1 delims=." %%m in ("!NODE_VERSION:v=!") do set "NODE_MAJOR=%%m"
if !NODE_MAJOR! LSS 22 (
  >>"%LAUNCHLOG%" echo Versao Node muito antiga: !NODE_VERSION!
  call :showerror "Esta versao do Life Sucos requer Node.js 22, 24 ou 26. Instale uma versao LTS atual e tente novamente."
  exit /b 1
)
if !NODE_MAJOR! GEQ 27 (
  >>"%LAUNCHLOG%" echo Versao Node ainda nao homologada: !NODE_VERSION!
  call :showerror "A versao instalada do Node.js ainda nao foi homologada para este Life Sucos. Use Node.js 24 LTS para maior compatibilidade."
  exit /b 1
)

rem ============================================================
rem 2) Confere dependencias. Se a instalacao anterior ficou incompleta,
rem    npm install corrige antes de tentar iniciar o servidor.
rem ============================================================
node -e "require('express');require('better-sqlite3');require('tesseract.js')" >nul 2>nul
if errorlevel 1 (
  >>"%LAUNCHLOG%" echo Dependencias ausentes/incompletas. Executando npm install...
  rem Remove somente a dependencia nativa caso uma tentativa anterior tenha ficado pela metade.
  if exist "node_modules\better-sqlite3" rmdir /s /q "node_modules\better-sqlite3" >nul 2>nul
  call npm install --no-audit --no-fund >>"%LAUNCHLOG%" 2>&1
  if errorlevel 1 (
    >>"%LAUNCHLOG%" echo Falha no npm install. Versao esperada do better-sqlite3: 12.11.1.
    call :showerror "Nao foi possivel instalar as dependencias do Life Sucos. Veja logs\inicializador.log para os detalhes."
    exit /b 1
  )
)

rem ============================================================
rem 3) IMPORTANTE: OCR nao e preparado aqui.
rem    O sistema abre primeiro. O idioma portugues e baixado/cacheado
rem    somente quando a funcao de foto for usada pela primeira vez.
rem ============================================================

rem ============================================================
rem 4) Inicializador Node robusto: evita problemas com caminhos com
rem    espacos/OneDrive e abre Chrome/Edge automaticamente.
rem ============================================================
node scripts\launch-app.js >>"%LAUNCHLOG%" 2>&1
if errorlevel 1 (
  call :showerror "O servidor nao respondeu a tempo. Veja logs\servidor.log para identificar o erro."
  exit /b 1
)

exit /b 0

:showerror
set "ERRMSG=%~1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('%ERRMSG%','Life Sucos','OK','Error')" >nul 2>nul
if errorlevel 1 (
  echo.
  echo [Life Sucos] %ERRMSG%
  echo.
  pause
)
exit /b 0
