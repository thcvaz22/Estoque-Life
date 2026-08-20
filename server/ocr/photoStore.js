/* ============================================================
   SERVER/OCR/PHOTOSTORE.JS — guarda as fotos originais de NFs e romaneios
   Salva em data/nf-photos/<id>.<ext>. Sem compressão automática
   nesta versão (fica como possível melhoria futura — ver README);
   fotos de celular já vêm razoavelmente compactadas em JPEG. A mesma pasta é usada para documentos de entrada e saída.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.LIFESUCOS_DATA_DIR || path.join(__dirname, '..', '..', 'data');
const PHOTOS_DIR = path.join(DATA_DIR, 'nf-photos');

const MIME_EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };

function ensureDir() {
  if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });
}

function savePhoto(buffer, mimeType) {
  ensureDir();
  const ext = MIME_EXT[mimeType] || 'jpg';
  const id = crypto.randomBytes(16).toString('hex');
  const filename = `${id}.${ext}`;
  fs.writeFileSync(path.join(PHOTOS_DIR, filename), buffer);
  return { id: filename, mimeType: mimeType || 'image/jpeg', size: buffer.length, savedAt: new Date().toISOString() };
}

function readPhoto(filename) {
  ensureDir();
  const safeName = path.basename(filename); // impede path traversal
  const fullPath = path.join(PHOTOS_DIR, safeName);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath);
}

function photoExists(filename) {
  const safeName = path.basename(filename);
  return fs.existsSync(path.join(PHOTOS_DIR, safeName));
}

module.exports = { savePhoto, readPhoto, photoExists, PHOTOS_DIR };
