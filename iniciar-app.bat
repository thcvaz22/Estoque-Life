@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>nul
set "LIFE_URL=https://life-sucos-aion.onrender.com"
start "" "%LIFE_URL%"
exit /b 0
