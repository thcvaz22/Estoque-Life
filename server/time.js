/* ============================================================
   SERVER/TIME.JS — helpers centralizados de data/hora
   Evita o bug de "toISOString().slice()" em campos locais
   (que mistura horário UTC com horário de parede local).
   O que fica salvo no banco é sempre UTC (nowUTCISOString);
   o que é exibido/editado como "hora local" usa estas funções.
   ============================================================ */

const TZ = 'America/Sao_Paulo';

// "YYYY-MM-DD" no fuso local
function todayLocalISO() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
}

// "YYYY-MM-DDTHH:mm" no fuso local — formato aceito por <input type="datetime-local">
function nowLocalDatetimeInput() {
  return new Date().toLocaleString('sv-SE', { timeZone: TZ }).replace(' ', 'T').slice(0, 16);
}

// Timestamp UTC em ISO 8601 — é o que fica gravado no banco
function nowUTCISOString() {
  return new Date().toISOString();
}

module.exports = { TZ, todayLocalISO, nowLocalDatetimeInput, nowUTCISOString };
