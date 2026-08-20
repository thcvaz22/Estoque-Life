@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>nul
cd /d "%~dp0"
title Life Sucos v16.2 - Publicar no GitHub

echo ================================================
echo LIFE SUCOS v16.2 - PUBLICAR NO GITHUB
echo Repositorio: thcvaz22/Estoque-Life
echo ================================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Git nao foi encontrado neste computador.
  echo Instale o Git for Windows e execute novamente.
  echo.
  pause
  exit /b 1
)

REM Configura identidade LOCAL apenas para este projeto, sem alterar outros repositorios.
for /f "delims=" %%i in ('git config --local user.name 2^>nul') do set "GIT_NAME=%%i"
if not defined GIT_NAME git config --local user.name "thcvaz22"

for /f "delims=" %%i in ('git config --local user.email 2^>nul') do set "GIT_EMAIL=%%i"
if not defined GIT_EMAIL git config --local user.email "313672630+thcvaz22@users.noreply.github.com"

REM Evita que avisos de fim de linha sejam tratados como problema.
git config --local core.autocrlf true >nul 2>nul

if not exist ".git" (
  echo Inicializando repositorio local...
  git init
  if errorlevel 1 goto :giterror
)

REM Reaplica a identidade depois do git init, caso seja um repositorio novo.
git config --local user.name "thcvaz22"
git config --local user.email "313672630+thcvaz22@users.noreply.github.com"
git config --local core.autocrlf true

git branch -M main >nul 2>nul

git remote get-url origin >nul 2>nul
if not errorlevel 1 git remote remove origin >nul 2>nul
git remote add origin https://github.com/thcvaz22/Estoque-Life.git
if errorlevel 1 goto :giterror

echo Adicionando arquivos seguros...
git add .
if errorlevel 1 goto :giterror

git diff --cached --quiet
if errorlevel 1 (
  echo Criando commit...
  git commit -m "Life Sucos v16.2 - login estavel + AION Skill 1.1 + Neon"
  if errorlevel 1 goto :giterror
) else (
  git rev-parse --verify HEAD >nul 2>nul
  if errorlevel 1 (
    echo [ERRO] Nao existe commit para publicar.
    goto :giterror
  ) else (
    echo Nenhuma alteracao nova para commit. Usando o commit existente.
  )
)

echo.
echo Enviando para o GitHub...
echo Se o navegador pedir autorizacao, entre na conta thcvaz22 e confirme.
git push -u origin main
if errorlevel 1 goto :pusherror

echo.
echo ================================================
echo PUBLICACAO CONCLUIDA COM SUCESSO
echo ================================================
echo Repositorio: https://github.com/thcvaz22/Estoque-Life
echo.
pause
exit /b 0

:giterror
echo.
echo [ERRO] O Git nao conseguiu preparar o commit.
echo Tire uma foto desta tela e me envie.
pause
exit /b 1

:pusherror
echo.
echo [ERRO] O GitHub nao aceitou o envio.
echo Se abrir uma janela/navegador, conclua a autorizacao da conta thcvaz22.
echo Depois execute este arquivo novamente.
echo Se continuar, tire uma foto desta tela e me envie.
pause
exit /b 1
