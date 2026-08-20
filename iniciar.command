#!/bin/bash
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "[ERRO] O Node.js não está instalado neste computador."
  echo "Baixe e instale em: https://nodejs.org (versão LTS)"
  echo "Depois, execute este arquivo novamente."
  echo ""
  read -p "Pressione Enter para sair..."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo ""
  echo "Primeira vez rodando o sistema — instalando dependências..."
  echo "(isso pode levar 1 a 2 minutos, só acontece uma vez)"
  echo ""
  npm install
  if [ $? -ne 0 ]; then
    echo ""
    echo "[ERRO] Falha ao instalar as dependências. Verifique sua conexão com a internet."
    read -p "Pressione Enter para sair..."
    exit 1
  fi
fi

echo ""
echo "Iniciando o Life Sucos..."
echo "Para PARAR o sistema, feche esta janela ou pressione Ctrl+C."
echo ""
npm start
