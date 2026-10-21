@echo off
chcp 65001 >nul
title Conversor de Extratos PDF - OFX
cd /d "%~dp0"

echo ============================================================
echo   Conversor de Extratos PDF ^<-^> OFX
echo   Para encerrar, feche esta janela.
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado. Instale em https://nodejs.org e tente de novo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Primeira execucao: instalando dependencias, aguarde...
  call npm ci
  if errorlevel 1 (
    echo [ERRO] Falha ao instalar as dependencias.
    pause
    exit /b 1
  )
)

echo Gerando o site...
call npm run build
if errorlevel 1 (
  echo [ERRO] Falha ao gerar o site.
  pause
  exit /b 1
)

echo.
echo Site disponivel em http://localhost:5199/
echo O navegador sera aberto automaticamente.
echo.
call npx vite preview --open

echo.
echo O servidor foi encerrado. Se a porta 5199 ja estava em uso, feche a outra
echo janela do conversor (ou o programa que usa a porta) e tente de novo.
pause
