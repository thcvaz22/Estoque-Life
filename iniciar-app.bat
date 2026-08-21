@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado. Instale Node.js 24 LTS.
  pause
  exit /b 1
)

node "scripts\launch-app.js"
if errorlevel 1 (
  echo.
  echo Nao foi possivel abrir o Life Sucos. Consulte logs\servidor.log.
  pause
)
