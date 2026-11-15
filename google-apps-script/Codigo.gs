/**
 * Tienda Online · Recepción de pedidos
 *
 * Proyecto de Apps Script de la tienda. La primera vez que se ejecuta "configurar" crea en tu
 * Google Drive la carpeta "Tienda Online" con la hoja "Tienda Online · Pedidos" y la carpeta "Comprobantes".
 * Recibe cada pedido de la tienda, guarda la foto del comprobante en Drive,
 * escribe una fila en la hoja, marca alertas y envía un correo de aviso.
 * También responde el seguimiento de pedidos (código + últimos 4 del celular).
 */

const CONFIG = {
  HOJA: 'Pedidos',
  LIBRO: 'Tienda Online · Pedidos',
  CARPETA_RAIZ: 'Tienda Online',
  CARPETA: 'Comprobantes',
  CORREO_AVISOS: '',          // vacío = el correo de la cuenta dueña de la hoja
  ABONO: 0.5,
  PRODUCTOS_URL: 'https://tiendaonline-ec.github.io/products.json', // catálogo publicado, para verificar precios
  MAX_PEDIDOS_POR_CELULAR_HORA: 5,
  ZONA_LOCAL: ['La Maná', 'Guasaganda', 'Pucayacu']  // donde se entrega directamente; lo demás va por servicio de entrega
};

const COLS = ['Fecha', 'Código', 'Estado', 'Nombre', 'Apellido', 'Cédula', 'Celular', 'Ciudad/cantón', 'Dirección', 'Envío', 'Productos', 'Códigos',
  'Total', 'Abono', 'Saldo', 'N.º comprobante', 'Monto depositado', 'Comprobante', 'Alertas',
  'Aceptó condiciones', 'Huella foto'];
const C = Object.fromEntries(COLS.map((c, i) => [c, i]));
const ESTADOS = ['Pendiente', 'Aprobado', 'En camino', 'Entregado', 'Rechazado'];
const ESTADO_KEY = { 'Pendiente': 'pendiente', 'Aprobado': 'aprobado', 'En camino': 'camino', 'Entregado': 'entregado', 'Rechazado': 'rechazado' };

/* ---------- Entradas web ---------- */
function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'Solicitud inválida.' }); }
  try {
    if (d.action === 'order') return out_(crearPedido_(d));
    if (d.action === 'track') return out_(consultar_(d.code, d.last4));
    if (d.action === 'trackMany') {
      const list = Array.isArray(d.list) ? d.list.slice(0, 20) : [];
      return out_({ ok: true, orders: list.map(x => consultar_(x.code, x.last4)).filter(r => r.ok) });
    }
    return out_({ ok: false, error: 'Acción desconocida.' });
  } catch (err) {
    console.error(err);
    return out_({ ok: false, error: 'No se pudo procesar el pedido. Intenta de nuevo.' });
  }
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'track') return out_(consultar_(p.code, p.last4));
  return out_({ ok: true, tienda: 'Tienda Online' });
}

/* Ejecuta esta función una vez si quieres crear la hoja y la carpeta antes del primer pedido. */
function configurar() {
  const ss = libro_();
  hoja_();
  const comp = carpeta_();
  // pone los nombres actuales a la hoja y a la carpeta principal
  try { DriveApp.getFileById(ss.getId()).setName(CONFIG.LIBRO); } catch (err) {}
  try { const p = comp.getParents(); if (p.hasNext()) p.next().setName(CONFIG.CARPETA_RAIZ); } catch (err) {}
  resumen_();
  console.log('Hoja de pedidos: ' + ss.getUrl());
  return ss.getUrl();
}

/* ---------- Pedidos ---------- */
function crearPedido_(d) {
  const t = s => String(s == null ? '' : s).trim();
  const nombre = t(d.name).slice(0, 60), apellido = t(d.last).slice(0, 60), cedula = t(d.cedula), cel = t(d.phone);
  const ciudad = t(d.city).replace(/\s+/g, ' ').slice(0, 60), direccion = t(d.address).replace(/\s+/g, ' ').slice(0, 200);
  const num = t(d.receipt && d.receipt.num).slice(0, 40);
  const monto = Number(d.receipt && d.receipt.amount);

  if (nombre.length < 2 || apellido.length < 2) return { ok: false, error: 'Faltan el nombre o el apellido.' };
  if (!cedulaOk_(cedula)) return { ok: false, error: 'La cédula no es válida.' };
  if (!/^09\d{8}$/.test(cel)) return { ok: false, error: 'El celular no es válido.' };
  if (ciudad.length < 3) return { ok: false, error: 'Falta la ciudad o cantón de entrega.' };
  if (direccion.length < 5) return { ok: false, error: 'Falta la dirección de entrega.' };
  const envio = esLocal_(ciudad) ? 'Local' : 'Servicio de entrega (costo aparte)';
  if (!Array.isArray(d.items) || !d.items.length) return { ok: false, error: 'El carrito está vacío.' };
  if (num.length < 4) return { ok: false, error: 'Falta el número de comprobante.' };
  if (!d.photo || !/^data:image\/(jpeg|png|webp);base64,/.test(d.photo)) return { ok: false, error: 'Falta la foto del comprobante.' };
  if (!d.terms) return { ok: false, error: 'Debes aceptar las condiciones.' };

  const cache = CacheService.getScriptCache();
  const kCel = 'cel_' + cel;
  const usados = Number(cache.get(kCel) || 0);
  if (usados >= CONFIG.MAX_PEDIDOS_POR_CELULAR_HORA) return { ok: false, error: 'Demasiados pedidos seguidos con este celular. Intenta más tarde.' };

  // Precios: si hay catálogo publicado se usan sus precios, no los que manda el navegador.
  const catalogo = catalogo_();
  const items = d.items.slice(0, 30).map(it => {
    const id = t(it.id);
    const qty = Math.max(1, Math.min(20, Math.floor(Number(it.qty) || 1)));
    const p = catalogo ? catalogo[id] : null;
    return { id, qty, name: p ? p.name : t(it.name), price: p ? Number(p.price) : Number(it.price) };
  }).filter(it => it.id && it.price > 0);
  if (!items.length) return { ok: false, error: 'Los productos ya no están disponibles.' };
  const total = r2_(items.reduce((s, i) => s + i.price * i.qty, 0));
  const abono = r2_(total * CONFIG.ABONO);

  const b64 = d.photo.slice(d.photo.indexOf(',') + 1);
  const mime = d.photo.slice(5, d.photo.indexOf(';'));
  const bytes = Utilities.base64Decode(b64);
  if (bytes.length > 6 * 1024 * 1024) return { ok: false, error: 'La foto del comprobante es muy pesada.' };
  const huella = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes));

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = hoja_();
    const datos = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, COLS.length).getValues() : [];
    const codigos = new Set(datos.map(r => r[C['Código']]));
    let code;
    do { code = 'PED-' + aleatorio_(4); } while (codigos.has(code));

    const ext = mime.split('/')[1] === 'jpeg' ? 'jpg' : mime.split('/')[1];
    const archivo = carpeta_().createFile(Utilities.newBlob(bytes, mime, `${code}_${num.replace(/[^\w-]/g, '')}.${ext}`));

    const alertas = [];
    const numNorm = num.replace(/\s/g, '').toUpperCase();
    datos.forEach(r => {
      if (String(r[C['N.º comprobante']]).replace(/\s/g, '').toUpperCase() === numNorm) alertas.push(`N.º de comprobante ya usado en ${r[C['Código']]}`);
      if (r[C['Huella foto']] && r[C['Huella foto']] === huella) alertas.push(`Misma foto que ${r[C['Código']]}`);
    });
    if (!(monto > 0) || monto + 0.005 < abono) alertas.push(`Monto ${fmt_(monto || 0)} menor al abono ${fmt_(abono)}`);

    const ahora = new Date();
    const fila = [ahora, code, 'Pendiente', texto_(nombre), texto_(apellido), "'" + cedula, "'" + cel,
      texto_(ciudad), texto_(direccion), envio,
      items.map(i => `${i.qty} x ${i.name}`).join('\n'), items.map(i => `${i.id} x${i.qty}`).join(', '),
      total, abono, r2_(total - abono), "'" + num, monto > 0 ? monto : '', 'Ver foto', alertas.join(' · '), ahora, huella];
    sh.appendRow(fila);
    const r = sh.getLastRow();
    sh.getRange(r, C['Comprobante'] + 1).setRichTextValue(
      SpreadsheetApp.newRichTextValue().setText('Ver foto').setLinkUrl(archivo.getUrl()).build());
    if (alertas.length) sh.getRange(r, 1, 1, COLS.length - 1).setBackground('#FDE2E2');

    cache.put(kCel, String(usados + 1), 3600);
    avisar_({ code, nombre, apellido, cel, ciudad, direccion, envio, items, total, abono, num, monto, archivo, alertas });
    return { ok: true, code, total, abono, status: 'pendiente', date: ahora.toISOString() };
  } finally {
    lock.releaseLock();
  }
}

/* ---------- Seguimiento ---------- */
function consultar_(code, last4) {
  code = String(code || '').toUpperCase().trim();
  last4 = String(last4 || '').trim();
  if (!/^PED-[A-Z0-9]{4}$/.test(code) || !/^\d{4}$/.test(last4)) return { ok: false, error: 'Datos incompletos.' };
  const sh = hoja_();
  if (sh.getLastRow() < 2) return { ok: false, error: 'No encontrado.' };
  const celda = sh.getRange(2, C['Código'] + 1, sh.getLastRow() - 1, 1).createTextFinder(code).matchEntireCell(true).findNext();
  if (!celda) return { ok: false, error: 'No encontrado.' };
  const r = sh.getRange(celda.getRow(), 1, 1, COLS.length).getValues()[0];
  if (String(r[C['Celular']]).slice(-4) !== last4) return { ok: false, error: 'No encontrado.' };
  const items = String(r[C['Códigos']]).split(',').map(s => s.trim()).filter(Boolean)
    .map(s => { const m = s.match(/^(\S+)\s+x(\d+)$/); return m ? { id: m[1], qty: Number(m[2]) } : null; }).filter(Boolean);
  return {
    ok: true, code, status: ESTADO_KEY[r[C['Estado']]] || 'pendiente',
    date: new Date(r[C['Fecha']]).toISOString(), total: Number(r[C['Total']]), abono: Number(r[C['Abono']]),
    items, lines: String(r[C['Productos']]).split('\n').filter(Boolean)
  };
}

/* ---------- Aviso por correo ---------- */
function avisar_(p) {
  const para = CONFIG.CORREO_AVISOS || Session.getEffectiveUser().getEmail();
  if (!para) return;
  const asunto = `${p.alertas.length ? 'REVISAR · ' : ''}Nuevo pedido ${p.code} · ${fmt_(p.total)}`;
  const cuerpo = [
    `Pedido ${p.code}`,
    `Cliente: ${p.nombre} ${p.apellido} · ${p.cel}`,
    `Entrega: ${p.direccion}, ${p.ciudad}`,
    `Envío: ${p.envio}`,
    '',
    ...p.items.map(i => `${i.qty} x ${i.name}   ${fmt_(i.price * i.qty)}`),
    '',
    `Total: ${fmt_(p.total)}`,
    `Abono a verificar: ${fmt_(p.abono)}`,
    `Comprobante N.º ${p.num} por ${fmt_(p.monto || 0)}`,
    p.alertas.length ? `Alertas: ${p.alertas.join(' · ')}` : 'Sin alertas.',
    '',
    `Hoja de pedidos: ${libro_().getUrl()}`
  ].join('\n');
  try {
    MailApp.sendEmail({ to: para, subject: asunto, body: cuerpo, attachments: [p.archivo.getBlob()] });
  } catch (err) { console.error(err); }
}

/* ---------- Auxiliares ---------- */
function libro_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('HOJA_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (err) {} }
  let ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (err) {}
  if (!ss) {
    ss = SpreadsheetApp.create(CONFIG.LIBRO);
    try { DriveApp.getFileById(ss.getId()).moveTo(raiz_()); } catch (err) {}
  }
  props.setProperty('HOJA_ID', ss.getId());
  return ss;
}

function raiz_() {
  const it = DriveApp.getFoldersByName(CONFIG.CARPETA_RAIZ);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.CARPETA_RAIZ);
}

function hoja_() {
  const ss = libro_();
  let sh = ss.getSheetByName(CONFIG.HOJA);
  if (!sh) {
    sh = ss.getSheets()[0];
    if (sh.getLastRow() > 0 || sh.getName() === 'Resumen') sh = ss.insertSheet(CONFIG.HOJA); else sh.setName(CONFIG.HOJA);
  }
  const enc = sh.getRange(1, 1, 1, COLS.length).getValues()[0];
  if (enc.join('|') !== COLS.join('|')) preparar_(sh);
  return sh;
}

/* Pone los encabezados y formatos. Si cambian las columnas, rehace la hoja (solo mientras no haya pedidos con el formato anterior). */
function preparar_(sh) {
  const filas = Math.max(1, sh.getMaxRows() - 1);
  if (sh.getLastRow() > 1 && sh.getRange(1, 1).getValue() === COLS[0]) {
    // ya hay pedidos con otras columnas: los guarda en una hoja aparte antes de rehacer
    const copia = sh.copyTo(sh.getParent()).setName('Pedidos anteriores ' + Utilities.formatDate(new Date(), 'America/Guayaquil', 'yyyy-MM-dd HH.mm'));
    copia.hideSheet();
    sh.getRange(2, 1, sh.getLastRow() - 1, sh.getMaxColumns()).clearContent();
  }
  sh.showColumns(1, sh.getMaxColumns());
  sh.getRange(2, 1, filas, sh.getMaxColumns()).clearFormat().clearDataValidations();
  sh.setColumnWidths(1, COLS.length, 120);
  sh.getRange(1, 1, 1, sh.getMaxColumns()).clearContent();
  sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold').setBackground('#1E66F5').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  sh.getRange(2, C['Estado'] + 1, filas, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(ESTADOS, true).setAllowInvalid(false).build());
  sh.getRange(2, C['Fecha'] + 1, filas, 1).setNumberFormat('dd/mm/yyyy hh:mm');
  sh.getRange(2, C['Aceptó condiciones'] + 1, filas, 1).setNumberFormat('dd/mm/yyyy hh:mm');
  ['Total', 'Abono', 'Saldo', 'Monto depositado'].forEach(c => sh.getRange(2, C[c] + 1, filas, 1).setNumberFormat('$#,##0.00'));
  sh.getRange(2, C['Productos'] + 1, filas, 1).setWrap(true);
  sh.getRange(2, C['Dirección'] + 1, filas, 1).setWrap(true);
  sh.setColumnWidth(C['Productos'] + 1, 260);
  sh.setColumnWidth(C['Dirección'] + 1, 240);
  sh.setColumnWidth(C['Envío'] + 1, 170);
  sh.setColumnWidth(C['Alertas'] + 1, 240);
  sh.hideColumns(C['Huella foto'] + 1);
}

/* Hoja "Resumen": las cuentas de la tienda con fórmulas que se actualizan solas con cada pedido. */
function resumen_() {
  const ss = libro_();
  hoja_();
  const letra = i => { let s = '', n = i + 1; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const R = c => `'${CONFIG.HOJA}'!${letra(C[c])}2:${letra(C[c])}`;
  const E = R('Estado'), F = R('Fecha');
  const sumaEn = (col, estados) => estados.map(e => `SUMIF(${E},"${e}",${R(col)})`).join('+');
  const CONF = ['Aprobado', 'En camino', 'Entregado'];
  const lunes = 'TODAY()-WEEKDAY(TODAY(),2)+1', mes = 'EOMONTH(TODAY(),-1)+1';

  let sh = ss.getSheetByName('Resumen');
  if (!sh) sh = ss.insertSheet('Resumen', 0);
  sh.clear();
  const filas = [
    ['Resumen de la tienda', ''],
    ['Se actualiza solo con cada pedido. Los pedidos rechazados no cuentan.', ''],
    ['', ''],
    ['Cuentas', 'Valor'],
    ['Ventas confirmadas (aprobados, en camino y entregados)', '=' + sumaEn('Total', CONF)],
    ['Dinero recibido (abonos confirmados + saldos de entregados)', `=${sumaEn('Abono', CONF)}+${sumaEn('Saldo', ['Entregado'])}`],
    ['Saldo por cobrar (aprobados y en camino)', '=' + sumaEn('Saldo', ['Aprobado', 'En camino'])],
    ['Abonos por verificar (pedidos pendientes)', '=' + sumaEn('Abono', ['Pendiente'])],
    ['Pedidos de esta semana (desde el lunes)', `=COUNTIFS(${F},">="&(${lunes}),${E},"<>Rechazado")`],
    ['Monto pedido esta semana', `=SUMIFS(${R('Total')},${F},">="&(${lunes}),${E},"<>Rechazado")`],
    ['Pedidos de este mes', `=COUNTIFS(${F},">="&(${mes}),${E},"<>Rechazado")`],
    ['Monto pedido este mes', `=SUMIFS(${R('Total')},${F},">="&(${mes}),${E},"<>Rechazado")`],
    ['Pedidos con alerta (revisar comprobante)', `=COUNTIF(${R('Alertas')},"?*")`],
    ['Envíos fuera de La Maná (sin rechazados)', `=COUNTIFS(${R('Envío')},"Servicio*",${E},"<>Rechazado")`]
  ];
  // los textos van con setValues y las fórmulas con setFormulas (que siempre usa comas, sin importar el idioma de la hoja)
  sh.getRange(1, 1, filas.length, 1).setValues(filas.map(f => [f[0]]));
  sh.getRange(4, 2).setValue('Valor');
  sh.getRange(5, 2, filas.length - 4, 1).setFormulas(filas.slice(4).map(f => [f[1]]));
  const t0 = filas.length + 2;
  sh.getRange(t0, 1, 1, 5).setValues([['Pedidos por estado', 'Pedidos', 'Total', 'Abono', 'Saldo']]);
  sh.getRange(t0 + 1, 1, ESTADOS.length, 1).setValues(ESTADOS.map(e => [e]));
  sh.getRange(t0 + 1, 2, ESTADOS.length, 4).setFormulas(ESTADOS.map(e => [
    `=COUNTIF(${E},"${e}")`, `=SUMIF(${E},"${e}",${R('Total')})`, `=SUMIF(${E},"${e}",${R('Abono')})`, `=SUMIF(${E},"${e}",${R('Saldo')})`]));

  sh.getRange('A1').setFontSize(16).setFontWeight('bold');
  sh.getRange('A2').setFontColor('#6B7280').setFontStyle('italic');
  [sh.getRange(4, 1, 1, 2), sh.getRange(t0, 1, 1, 5)].forEach(r => r.setFontWeight('bold').setBackground('#1E66F5').setFontColor('#FFFFFF'));
  [5, 6, 7, 8, 10, 12].forEach(r => sh.getRange(r, 2).setNumberFormat('$#,##0.00'));
  [9, 11, 13, 14].forEach(r => sh.getRange(r, 2).setNumberFormat('0'));
  sh.getRange(t0 + 1, 3, ESTADOS.length, 3).setNumberFormat('$#,##0.00');
  sh.getRange(6, 1, 1, 2).setFontWeight('bold');
  sh.setColumnWidth(1, 400);
  sh.setColumnWidths(2, 4, 110);
  sh.setFrozenRows(0);
  return sh;
}

function carpeta_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('CARPETA_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (err) {} }
  const raiz = raiz_();
  const it = raiz.getFoldersByName(CONFIG.CARPETA);
  const f = it.hasNext() ? it.next() : raiz.createFolder(CONFIG.CARPETA);
  props.setProperty('CARPETA_ID', f.getId());
  return f;
}

function catalogo_() {
  if (!CONFIG.PRODUCTOS_URL) return null;
  const cache = CacheService.getScriptCache();
  let txt = cache.get('catalogo');
  if (!txt) {
    try {
      const res = UrlFetchApp.fetch(CONFIG.PRODUCTOS_URL, { muteHttpExceptions: true });
      if (res.getResponseCode() !== 200) return null;
      txt = res.getContentText();
      if (txt.length < 95000) cache.put('catalogo', txt, 600);
    } catch (err) { return null; }
  }
  try {
    const data = JSON.parse(txt);
    const list = Array.isArray(data) ? data : data.products;
    return Object.fromEntries(list.map(p => [p.id, p]));
  } catch (err) { return null; }
}

function cedulaOk_(c) {
  if (!/^\d{10}$/.test(c)) return false;
  const prov = Number(c.slice(0, 2));
  if (!((prov >= 1 && prov <= 24) || prov === 30) || Number(c[2]) > 5) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) { let v = Number(c[i]) * (i % 2 ? 1 : 2); if (v > 9) v -= 9; s += v; }
  return (10 - s % 10) % 10 === Number(c[9]);
}

function aleatorio_(n) {
  const A = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < n; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

const sinTildes_ = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
function esLocal_(ciudad) {
  const n = sinTildes_(ciudad);
  return !!n && CONFIG.ZONA_LOCAL.some(z => n.includes(sinTildes_(z)));
}
// evita que un texto escrito por la clienta se lea como fórmula en la hoja
const texto_ = s => /^[=+\-@]/.test(s) ? "'" + s : s;
const r2_ = n => Math.round(n * 100) / 100;
const fmt_ = n => '$' + Number(n).toFixed(2);
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
