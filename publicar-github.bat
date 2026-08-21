@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Life Sucos v16.3 - Atualizar GitHub

echo ==============================================================
echo LIFE SUCOS v16.3 - ATUALIZAR GITHUB COM SEGURANCA
echo ==============================================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Git nao encontrado neste computador.
  echo Instale o Git for Windows e execute este arquivo novamente.
  pause
  exit /b 1
)

set "REPO=https://github.com/thcvaz22/Estoque-Life.git"
set "TMP=%TEMP%\Life-Sucos-GitHub-v163-%RANDOM%-%RANDOM%"

echo [1/5] Clonando a versao atual do GitHub...
git clone "%REPO%" "%TMP%"
if errorlevel 1 goto :erro

echo [2/5] Copiando a v16.3 para o clone limpo...
robocopy "%~dp0" "%TMP%" /E /R:1 /W:1 /XD ".git" "node_modules" "data" /XF ".env" "PRIMEIRO_ACESSO_ADMIN.txt" "*.db" "*.sqlite" "*.sqlite3" "*.key" >nul
set RC=%ERRORLEVEL%
if %RC% GEQ 8 goto :erro

cd /d "%TMP%"
git config user.name "thcvaz22"
git config user.email "thcvaz22@gmail.com"

echo [3/5] Preparando alteracoes...
git add -A

git diff --cached --quiet
if not errorlevel 1 (
  echo Nao ha alteracoes novas para publicar.
  goto :sucesso
)

echo [4/5] Criando commit...
git commit -m "Life Sucos v16.3 - cloud estavel, disco persistente e Neon mirror"
if errorlevel 1 goto :erro

echo [5/5] Enviando para o GitHub...
git push origin main
if errorlevel 1 goto :erro

:sucesso
echo.
echo ==============================================================
echo PUBLICACAO/ATUALIZACAO CONCLUIDA COM SUCESSO
echo ==============================================================
echo Repositorio: https://github.com/thcvaz22/Estoque-Life
echo.
cd /d "%~dp0"
rmdir /s /q "%TMP%" >nul 2>nul
pause
exit /b 0

:erro
echo.
echo ==============================================================
echo NAO FOI POSSIVEL CONCLUIR A ATUALIZACAO
echo ==============================================================
echo A pasta temporaria foi preservada para diagnostico:
echo %TMP%
echo.
pause
exit /b 1
