/* ============================================================
   EXPORT.JS — exportação de relatórios para PDF, Excel e impressão
   Bibliotecas via CDN: jsPDF + jspdf-autotable, SheetJS (xlsx).
   Todas as funções recebem: título, colunas [{label,key|get}], linhas.
   ============================================================ */

function exportPDF(title, headers, rows, { subtitle = '' } = {}) {
  if (typeof window.jspdf === 'undefined') { toast('Biblioteca de PDF indisponível offline no momento.', 'warn'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: headers.length > 6 ? 'landscape' : 'portrait' });
  doc.setFontSize(14);
  doc.text(title, 14, 16);
  if (subtitle) { doc.setFontSize(9); doc.setTextColor(110); doc.text(subtitle, 14, 22); }
  doc.autoTable({
    startY: subtitle ? 27 : 22,
    head: [headers.map(h => h.label)],
    body: rows.map(r => headers.map(h => String((typeof h.get === 'function' ? h.get(r) : r[h.key]) ?? ''))),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [36, 64, 90] },
    alternateRowStyles: { fillColor: [244, 246, 244] }
  });
  doc.save(`${title.replace(/\s+/g, '_')}.pdf`);
}

function exportExcel(title, headers, rows) {
  if (typeof XLSX === 'undefined') { toast('Biblioteca de Excel indisponível offline no momento.', 'warn'); return; }
  const data = rows.map(r => {
    const obj = {};
    headers.forEach(h => { obj[h.label] = typeof h.get === 'function' ? h.get(r) : r[h.key]; });
    return obj;
  });
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 28) || 'Relatório');
  XLSX.writeFile(wb, `${title.replace(/\s+/g, '_')}.xlsx`);
}

function exportCSVReport(title, headers, rows) {
  downloadFile(`${title.replace(/\s+/g, '_')}.csv`, toCSV(rows, headers));
}

function printReport(title, headers, rows, { subtitle = '' } = {}) {
  const win = window.open('', '_blank');
  const tableRows = rows.map(r => `<tr>${headers.map(h => `<td>${escapeHTML(typeof h.get === 'function' ? h.get(r) : r[h.key])}</td>`).join('')}</tr>`).join('');
  win.document.write(`
    <html><head><title>${escapeHTML(title)}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:24px;color:#222}
      h1{font-size:18px;margin-bottom:2px} p{color:#666;font-size:12px;margin-top:0}
      table{width:100%;border-collapse:collapse;margin-top:16px;font-size:12px}
      th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
      th{background:#24405A;color:#fff}
      tr:nth-child(even){background:#f4f6f4}
    </style></head><body>
    <h1>${escapeHTML(title)}</h1>${subtitle ? `<p>${escapeHTML(subtitle)}</p>` : ''}
    <table><thead><tr>${headers.map(h => `<th>${escapeHTML(h.label)}</th>`).join('')}</tr></thead>
    <tbody>${tableRows}</tbody></table>
    <script>window.onload=()=>window.print()</script>
    </body></html>`);
  win.document.close();
}
