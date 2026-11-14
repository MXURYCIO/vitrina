/**
 * Vitrina · Recepción de pedidos
 *
 * Proyecto de Apps Script de la tienda. La primera vez que se ejecuta "configurar" crea en tu
 * Google Drive la carpeta "Vitrina" con la hoja "Vitrina · Pedidos" y la carpeta "Comprobantes".
 * Recibe cada pedido de la tienda, guarda la foto del comprobante en Drive,
 * escribe una fila en la hoja, marca alertas y envía un correo de aviso.
 * También responde el seguimiento de pedidos (código + últimos 4 del celular).
 */

const CONFIG = {
  HOJA: 'Pedidos',
  LIBRO: 'Vitrina · Pedidos',
  CARPETA_RAIZ: 'Vitrina',
  CARPETA: 'Comprobantes',
  CORREO_AVISOS: '',          // vacío = el correo de la cuenta dueña de la hoja
  ABONO: 0.5,
  PRODUCTOS_URL: '',          // ej. https://mxurycio.github.io/vitrina/products.json (para verificar precios)
  MAX_PEDIDOS_POR_CELULAR_HORA: 5
};

const COLS = ['Fecha', 'Código', 'Estado', 'Nombre', 'Apellido', 'Cédula', 'Celular', 'Productos', 'Códigos',
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
  return out_({ ok: true, tienda: 'Vitrina' });
}

/* Ejecuta esta función una vez si quieres crear la hoja y la carpeta antes del primer pedido. */
function configurar() {
  const ss = libro_();
  hoja_();
  carpeta_();
  console.log('Hoja de pedidos: ' + ss.getUrl());
  return ss.getUrl();
}

/* ---------- Pedidos ---------- */
function crearPedido_(d) {
  const t = s => String(s == null ? '' : s).trim();
  const nombre = t(d.name), apellido = t(d.last), cedula = t(d.cedula), cel = t(d.phone);
  const num = t(d.receipt && d.receipt.num);
  const monto = Number(d.receipt && d.receipt.amount);

  if (nombre.length < 2 || apellido.length < 2) return { ok: false, error: 'Faltan el nombre o el apellido.' };
  if (!cedulaOk_(cedula)) return { ok: false, error: 'La cédula no es válida.' };
  if (!/^09\d{8}$/.test(cel)) return { ok: false, error: 'El celular no es válido.' };
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
    do { code = 'VT-' + aleatorio_(4); } while (codigos.has(code));

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
    const fila = [ahora, code, 'Pendiente', nombre, apellido, "'" + cedula, "'" + cel,
      items.map(i => `${i.qty} x ${i.name}`).join('\n'), items.map(i => `${i.id} x${i.qty}`).join(', '),
      total, abono, r2_(total - abono), "'" + num, monto > 0 ? monto : '', 'Ver foto', alertas.join(' · '), ahora, huella];
    sh.appendRow(fila);
    const r = sh.getLastRow();
    sh.getRange(r, C['Comprobante'] + 1).setRichTextValue(
      SpreadsheetApp.newRichTextValue().setText('Ver foto').setLinkUrl(archivo.getUrl()).build());
    if (alertas.length) sh.getRange(r, 1, 1, COLS.length - 1).setBackground('#FDE2E2');

    cache.put(kCel, String(usados + 1), 3600);
    avisar_({ code, nombre, apellido, cel, items, total, abono, num, monto, archivo, alertas });
    return { ok: true, code, total, abono, status: 'pendiente', date: ahora.toISOString() };
  } finally {
    lock.releaseLock();
  }
}

/* ---------- Seguimiento ---------- */
function consultar_(code, last4) {
  code = String(code || '').toUpperCase().trim();
  last4 = String(last4 || '').trim();
  if (!/^VT-[A-Z0-9]{4}$/.test(code) || !/^\d{4}$/.test(last4)) return { ok: false, error: 'Datos incompletos.' };
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
    if (sh.getLastRow() > 0) sh = ss.insertSheet(CONFIG.HOJA); else sh.setName(CONFIG.HOJA);
  }
  if (sh.getRange(1, 1).getValue() !== COLS[0]) preparar_(sh);
  return sh;
}

function preparar_(sh) {
  const filas = Math.max(1, sh.getMaxRows() - 1);
  sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold').setBackground('#1E66F5').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  sh.getRange(2, C['Estado'] + 1, filas, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(ESTADOS, true).setAllowInvalid(false).build());
  sh.getRange(2, C['Fecha'] + 1, filas, 1).setNumberFormat('dd/mm/yyyy hh:mm');
  sh.getRange(2, C['Aceptó condiciones'] + 1, filas, 1).setNumberFormat('dd/mm/yyyy hh:mm');
  ['Total', 'Abono', 'Saldo', 'Monto depositado'].forEach(c => sh.getRange(2, C[c] + 1, filas, 1).setNumberFormat('$#,##0.00'));
  sh.getRange(2, C['Productos'] + 1, filas, 1).setWrap(true);
  sh.setColumnWidth(C['Productos'] + 1, 260);
  sh.setColumnWidth(C['Alertas'] + 1, 240);
  sh.hideColumns(C['Huella foto'] + 1);
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

const r2_ = n => Math.round(n * 100) / 100;
const fmt_ = n => '$' + Number(n).toFixed(2);
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
