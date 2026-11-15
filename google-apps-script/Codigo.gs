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
  MAX_PEDIDOS_POR_HORA: 40,
  ZONA_LOCAL: ['La Maná', 'Guasaganda', 'Pucayacu'], // donde se entrega directamente; lo demás va por servicio de entrega
  CUENTA_DESTINO: '2216883431',                       // cuenta donde depositan (la misma que muestra la tienda)
  TITULAR_CLAVES: ['Yomaira', 'Moreira Litardo']      // partes del nombre del titular que pueden salir en el comprobante
};

const COLS = ['Fecha', 'Código', 'Estado', 'Nombre', 'Apellido', 'Cédula', 'Celular', 'Ciudad/cantón', 'Dirección', 'Envío', 'Productos', 'Códigos',
  'Total', 'Abono', 'Saldo', 'N.º comprobante', 'Monto depositado', 'Comprobante', 'Alertas',
  'Aceptó condiciones', 'Huella foto', 'Comprobante leído'];
const C = Object.fromEntries(COLS.map((c, i) => [c, i]));
const ESTADOS = ['Pendiente', 'Aprobado', 'En camino', 'Entregado', 'Rechazado'];
const ESTADO_KEY = { 'Pendiente': 'pendiente', 'Aprobado': 'aprobado', 'En camino': 'camino', 'Entregado': 'entregado', 'Rechazado': 'rechazado' };

/* ---------- Entradas web ---------- */
function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'Solicitud inválida.' }); }
  try {
    if (d.action === 'order') return out_(crearPedido_(d));
    if (d.action === 'estados') return out_({ ok: true, estados: estados_() });
    if (d.action === 'admin') return out_(admin_(d));
    if (d.action === 'track') return out_(consultar_(d.code, d.last4));
    if (d.action === 'trackMany') {
      const list = Array.isArray(d.list) ? d.list.slice(0, 20) : [];
      return out_({ ok: true, orders: list.map(x => consultar_(x.code, x.last4)).filter(r => r.ok) });
    }
    return out_({ ok: false, error: 'Acción desconocida.' });
  } catch (err) {
    console.error(err);
    return out_({ ok: false, error: d.action === 'order' ? 'No se pudo procesar el pedido. Intenta de nuevo.' : 'No se pudo completar. Intenta de nuevo.' });
  }
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'track') return out_(consultar_(p.code, p.last4));
  if (p.action === 'estados') return out_({ ok: true, estados: estados_() });
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
  hojaRev_();
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

  // Límite general por hora: evita que alguien llene la hoja (y el cupo de correos) con pedidos falsos.
  const kHora = 'pedidos_hora';
  const enHora = Number(cache.get(kHora) || 0);
  if (enHora >= CONFIG.MAX_PEDIDOS_POR_HORA) return { ok: false, error: 'Estamos recibiendo muchos pedidos. Intenta de nuevo en unos minutos.' };

  // Precios: siempre los del catálogo publicado, nunca los que manda el navegador (que se pueden manipular).
  const catalogo = catalogo_();
  if (!catalogo) return { ok: false, error: 'No pudimos verificar los precios. Intenta de nuevo en un momento.' };
  const est = estados_();
  const pedidos = {};
  d.items.slice(0, 30).forEach(it => {
    const id = t(it.id);
    if (!id) return;
    pedidos[id] = Math.min(20, (pedidos[id] || 0) + Math.max(1, Math.floor(Number(it.qty) || 1)));
  });
  const items = [], faltan = [];
  Object.keys(pedidos).forEach(id => {
    const p = catalogo[id];
    if (!p || !(Number(p.price) > 0) || (est[id] || p.status || 'aprobado') !== 'aprobado') { faltan.push(p ? p.name : id); return; }
    items.push({ id, qty: pedidos[id], name: p.name, price: Number(p.price) });
  });
  if (faltan.length) return { ok: false, code: 'catalogo', error: `Ya no está disponible: ${faltan.join(', ')}. Quítalo del carrito para continuar.` };
  if (!items.length) return { ok: false, error: 'El carrito está vacío.' };
  const total = r2_(items.reduce((s, i) => s + i.price * i.qty, 0));
  const abono = r2_(total * CONFIG.ABONO);
  // si el total que vio la clienta no coincide (precio cambiado o manipulado), no se registra el pedido
  if (d.total != null && Math.abs(Number(d.total) - total) > 0.009) {
    return { ok: false, code: 'catalogo', error: `Los precios se actualizaron. El total correcto es ${fmt_(total)} y el abono ${fmt_(abono)}. Revisa tu carrito.` };
  }

  const b64 = d.photo.slice(d.photo.indexOf(',') + 1);
  const mime = d.photo.slice(5, d.photo.indexOf(';'));
  const bytes = Utilities.base64Decode(b64);
  if (bytes.length > 6 * 1024 * 1024) return { ok: false, error: 'La foto del comprobante es muy pesada.' };
  const huella = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes));
  // lectura automática de la foto: monto, cuenta de destino y número de comprobante (antes del candado, porque tarda unos segundos)
  const lectura = leerComprobante_(bytes, mime, monto, abono, num);

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
    lectura.alertas.forEach(a => alertas.push(a));

    const ahora = new Date();
    const fila = [ahora, code, 'Pendiente', texto_(nombre), texto_(apellido), "'" + cedula, "'" + cel,
      texto_(ciudad), texto_(direccion), envio,
      items.map(i => `${i.qty} x ${i.name}`).join('\n'), items.map(i => `${i.id} x${i.qty}`).join(', '),
      total, abono, r2_(total - abono), "'" + num, monto > 0 ? monto : '', 'Ver foto', alertas.join(' · '), ahora, huella, lectura.resumen];
    sh.appendRow(fila);
    const r = sh.getLastRow();
    sh.getRange(r, C['Comprobante'] + 1).setRichTextValue(
      SpreadsheetApp.newRichTextValue().setText('Ver foto').setLinkUrl(archivo.getUrl()).build());
    if (alertas.length) sh.getRange(r, 1, 1, COLS.length).setBackground('#FDE2E2');

    cache.put(kCel, String(usados + 1), 3600);
    cache.put(kHora, String(Number(cache.get(kHora) || 0) + 1), 3600);
    avisar_({ code, nombre, apellido, cel, ciudad, direccion, envio, items, total, abono, num, monto, archivo, alertas, lectura: lectura.resumen });
    return { ok: true, code, total, abono, status: 'pendiente', date: ahora.toISOString() };
  } finally {
    lock.releaseLock();
  }
}

/* ---------- Lectura automática del comprobante ----------
 * Convierte la foto en texto con el lector de Google Drive y revisa tres cosas:
 * que el monto declarado aparezca, que no sea menor al abono y que se vea la cuenta (o el nombre) de destino.
 * Nunca rechaza el pedido: solo agrega alertas para que la dueña lo revise antes de aprobar. */
function leerComprobante_(bytes, mime, monto, abono, num) {
  let texto = '', id = null;
  try {
    const f = Drive.Files.create({ name: 'lectura-comprobante-temporal', mimeType: 'application/vnd.google-apps.document' },
      Utilities.newBlob(bytes, mime, 'comprobante'), { ocrLanguage: 'es', fields: 'id' });
    id = f.id;
    const res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '/export?mimeType=text%2Fplain',
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (res.getResponseCode() === 200) texto = res.getContentText();
  } catch (err) {
    console.error(err);
  } finally {
    if (id) { try { Drive.Files.remove(id); } catch (e) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e2) {} } }
  }
  return analizarComprobante_(texto, monto, abono, num);
}

function analizarComprobante_(texto, monto, abono, num) {
  const t = String(texto || '').replace(/ /g, ' ');
  const out = { texto: t, alertas: [], resumen: '' };
  if (!t.replace(/\s/g, '')) {
    out.alertas.push('No se pudo leer la foto del comprobante');
    out.resumen = 'No se pudo leer la foto';
    return out;
  }
  // montos: "$5,00", "$ 5.00", "USD 12.50", "1.234,56"
  const montos = [];
  const re = /(\$|usd|us\$)?\s?(\d{1,3}(?:[.,]\d{3})+[.,]\d{2}|\d{1,5}[.,]\d{2})(?!\d)/gi;
  let m;
  while ((m = re.exec(t))) {
    const raw = m[2], k = Math.max(raw.lastIndexOf('.'), raw.lastIndexOf(','));
    const v = Number(raw.slice(0, k).replace(/[.,]/g, '') + '.' + raw.slice(k + 1));
    if (v > 0 && v < 100000) montos.push({ v, signo: !!m[1] });
  }
  const conSigno = montos.filter(x => x.signo).map(x => x.v);
  const todos = montos.map(x => x.v);
  const lista = [...new Set(conSigno.length ? conSigno : todos)];
  const cerca = (a, b) => Math.abs(a - b) < 0.006;
  const digitos = t.replace(/\D/g, '');
  const plano = sinTildes_(t);

  if (!todos.length) out.alertas.push('No se encontró el monto en el comprobante');
  else {
    if (!(monto > 0) || !todos.some(v => cerca(v, monto))) out.alertas.push(`El comprobante no muestra ${fmt_(monto || 0)} (se leyó ${lista.slice(0, 3).map(fmt_).join(', ')})`);
    if (Math.max(...lista) + 0.005 < abono) out.alertas.push(`El comprobante muestra ${fmt_(Math.max(...lista))}, menos que el abono ${fmt_(abono)}`);
  }
  const ult4 = CONFIG.CUENTA_DESTINO.slice(-4);
  const cuentaOk = digitos.includes(ult4) || CONFIG.TITULAR_CLAVES.some(k => plano.includes(sinTildes_(k)));
  if (!cuentaOk) out.alertas.push(`No se ve la cuenta de destino (termina en ${ult4}) ni el nombre del titular`);
  const nd = String(num || '').replace(/\D/g, '');
  const numOk = nd.length >= 4 && digitos.includes(nd);
  if (nd.length >= 4 && !numOk) out.alertas.push(`El N.º de comprobante ${num} no aparece en la foto`);
  out.resumen = `Monto leído: ${lista.length ? lista.slice(0, 3).map(fmt_).join(', ') : 'no se encontró'} · Cuenta destino: ${cuentaOk ? 'sí' : 'no'} · N.º: ${numOk ? 'sí' : 'no'}`;
  return out;
}

/* ---------- Revisión de productos (solo dueño, con PIN) ----------
 * La tienda muestra a las clientas solo los productos aprobados. Las decisiones del dueño se guardan
 * en la hoja "Revisión" (una fila por producto). El PIN vive en Propiedades del script (ADMIN_PIN),
 * nunca en este código, que es público en GitHub. */
const REV_COLS = ['ID', 'Producto', 'Estado', 'Comentario', 'Actualizado'];
const REV_TXT = { pendiente: 'Por aprobar', aprobado: 'Aprobado', rechazado: 'Rechazado', editar: 'Editar' };

function admin_(d) {
  const pin = PropertiesService.getScriptProperties().getProperty('ADMIN_PIN');
  if (!pin) return { ok: false, error: 'Falta configurar el PIN de dueño.' };
  const cache = CacheService.getScriptCache();
  const fallas = Number(cache.get('pin_fallas') || 0);
  if (fallas >= 8) return { ok: false, error: 'Demasiados intentos con PIN incorrecto. Espera 15 minutos.' };
  if (String(d.pin || '') !== pin) {
    cache.put('pin_fallas', String(fallas + 1), 900);
    return { ok: false, pin: true, error: 'PIN incorrecto.' };
  }
  // la llave COSTOS_LLAVE (Propiedades del script) descifra costos.json: el precio de Telegram que solo ve el dueño
  if (d.op === 'revision') return { ok: true, revision: leerRev_(), llave: PropertiesService.getScriptProperties().getProperty('COSTOS_LLAVE') || '' };
  if (d.op === 'pedidos') return buscarPedidos_(String(d.q || ''));
  if (d.op === 'estado') return cambiarEstado_(String(d.code || ''), String(d.estado || ''));
  if (d.op === 'leer') {
    // prueba de la lectura automática sin crear pedido
    if (!d.photo || !/^data:image\/(jpeg|png|webp);base64,/.test(d.photo)) return { ok: false, error: 'Falta la foto.' };
    const bytes = Utilities.base64Decode(d.photo.slice(d.photo.indexOf(',') + 1));
    const l = leerComprobante_(bytes, d.photo.slice(5, d.photo.indexOf(';')), Number(d.monto), Number(d.abono || d.monto), String(d.num || ''));
    return { ok: true, resumen: l.resumen, alertas: l.alertas, texto: l.texto.slice(0, 600) };
  }
  if (d.op === 'decidir') return decidir_(d);
  return { ok: false, error: 'Acción desconocida.' };
}

function decidir_(d) {
  const estado = String(d.estado || '');
  if (!REV_TXT[estado]) return { ok: false, error: 'Estado no válido.' };
  const comentario = String(d.comentario || '').trim().slice(0, 500);
  if (estado === 'editar' && comentario.length < 3) return { ok: false, error: 'Escribe qué quieres cambiar.' };
  const ids = (Array.isArray(d.ids) ? d.ids : []).map(x => String(x).trim()).filter(id => /^[A-Z]{1,4}-\d{1,6}$/.test(id)).slice(0, 300);
  if (!ids.length) return { ok: false, error: 'No hay productos para actualizar.' };
  const cat = catalogo_() || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = hojaRev_();
    const n = sh.getLastRow() - 1;
    const filas = n > 0 ? sh.getRange(2, 1, n, REV_COLS.length).getValues() : [];
    const pos = {};
    filas.forEach((r, i) => { pos[String(r[0]).trim()] = i; });
    const ahora = new Date();
    ids.forEach(id => {
      const fila = [id, cat[id] ? cat[id].name : '', REV_TXT[estado], estado === 'editar' ? comentario : '', ahora];
      if (id in pos) { if (!fila[1]) fila[1] = filas[pos[id]][1]; filas[pos[id]] = fila; }
      else { pos[id] = filas.length; filas.push(fila); }
    });
    sh.getRange(2, 1, filas.length, REV_COLS.length)
      .setValues(filas.map(r => [r[0], texto_(String(r[1] || '')), r[2], texto_(String(r[3] || '')), r[4]]));
    CacheService.getScriptCache().remove('estados');
    return { ok: true, estados: estados_() };
  } finally {
    lock.releaseLock();
  }
}

// { id: { s: 'aprobado' | 'rechazado' | 'editar' | 'pendiente', c: comentario } }
function leerRev_() {
  const sh = hojaRev_();
  const n = sh.getLastRow() - 1;
  const out = {};
  if (n < 1) return out;
  sh.getRange(2, 1, n, 4).getValues().forEach(r => {
    const id = String(r[0]).trim();
    if (!id) return;
    const s = Object.keys(REV_TXT).find(k => REV_TXT[k] === r[2]) || 'pendiente';
    out[id] = { s, c: String(r[3] || '') };
  });
  return out;
}

// lo que ve la tienda: solo el estado de cada producto (sin comentarios), guardado 5 minutos
function estados_() {
  const cache = CacheService.getScriptCache();
  const c = cache.get('estados');
  if (c) return JSON.parse(c);
  const e = {};
  Object.entries(leerRev_()).forEach(([id, v]) => { e[id] = v.s; });
  cache.put('estados', JSON.stringify(e), 300);
  return e;
}

function hojaRev_() {
  const ss = libro_();
  let sh = ss.getSheetByName('Revisión');
  if (!sh) {
    sh = ss.insertSheet('Revisión');
    sh.getRange(1, 1, 1, REV_COLS.length).setValues([REV_COLS]).setFontWeight('bold').setBackground('#1E66F5').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    const filas = Math.max(1, sh.getMaxRows() - 1);
    sh.getRange(2, 3, filas, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(Object.values(REV_TXT), true).setAllowInvalid(false).build());
    sh.getRange(2, 5, filas, 1).setNumberFormat('dd/mm/yyyy hh:mm');
    sh.getRange(2, 4, filas, 1).setWrap(true);
    sh.setColumnWidth(2, 280);
    sh.setColumnWidth(4, 320);
    sh.setColumnWidth(5, 140);
  }
  return sh;
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

/* ---------- Pedidos para la dueña (con PIN) ---------- */
// Busca por código (PED-XXXX o solo XXXX), nombre/apellido o celular. Sin búsqueda devuelve los más recientes.
function buscarPedidos_(q) {
  const sh = hoja_();
  const n = sh.getLastRow() - 1;
  if (n < 1) return { ok: true, pedidos: [] };
  const vals = sh.getRange(2, 1, n, COLS.length).getValues();
  const fotos = sh.getRange(2, C['Comprobante'] + 1, n, 1).getRichTextValues();
  const qTxt = sinTildes_(q), qCode = q.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^PED/, ''), qNum = q.replace(/\D/g, '');
  const out = [];
  for (let i = n - 1; i >= 0 && out.length < 60; i--) {
    const r = vals[i];
    const code = String(r[C['Código']] || '');
    if (!code) continue;
    if (q.trim()) {
      const porCodigo = qCode.length >= 2 && code.replace(/^PED-/, '').includes(qCode);
      const porNombre = qTxt.length >= 2 && sinTildes_(r[C['Nombre']] + ' ' + r[C['Apellido']]).includes(qTxt);
      const porCelular = qNum.length >= 4 && String(r[C['Celular']]).includes(qNum);
      if (!porCodigo && !porNombre && !porCelular) continue;
    }
    out.push(filaPedido_(r, fotos[i][0]));
  }
  return { ok: true, pedidos: out };
}

function filaPedido_(r, rich) {
  const fecha = r[C['Fecha']] instanceof Date ? r[C['Fecha']] : new Date(r[C['Fecha']]);
  return {
    code: String(r[C['Código']]), fecha: Utilities.formatDate(fecha, 'America/Guayaquil', 'dd/MM/yyyy HH:mm'),
    estado: ESTADO_KEY[r[C['Estado']]] || 'pendiente',
    nombre: String(r[C['Nombre']]), apellido: String(r[C['Apellido']]), cedula: String(r[C['Cédula']]), celular: String(r[C['Celular']]),
    ciudad: String(r[C['Ciudad/cantón']] || ''), direccion: String(r[C['Dirección']] || ''), envio: String(r[C['Envío']] || ''),
    productos: String(r[C['Productos']]).split('\n').filter(Boolean),
    total: Number(r[C['Total']]) || 0, abono: Number(r[C['Abono']]) || 0, saldo: Number(r[C['Saldo']]) || 0,
    num: String(r[C['N.º comprobante']] || ''), monto: Number(r[C['Monto depositado']]) || 0,
    foto: rich && rich.getLinkUrl() ? rich.getLinkUrl() : '',
    alertas: String(r[C['Alertas']] || ''), lectura: String(r[C['Comprobante leído']] || '')
  };
}

function cambiarEstado_(code, estado) {
  code = code.toUpperCase().trim();
  const texto = Object.keys(ESTADO_KEY).find(k => ESTADO_KEY[k] === estado);
  if (!/^PED-[A-Z0-9]{4}$/.test(code) || !texto) return { ok: false, error: 'Datos no válidos.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = hoja_();
    if (sh.getLastRow() < 2) return { ok: false, error: 'No encontrado.' };
    const celda = sh.getRange(2, C['Código'] + 1, sh.getLastRow() - 1, 1).createTextFinder(code).matchEntireCell(true).findNext();
    if (!celda) return { ok: false, error: 'No encontrado.' };
    const fila = celda.getRow();
    sh.getRange(fila, C['Estado'] + 1).setValue(texto);
    const r = sh.getRange(fila, 1, 1, COLS.length).getValues()[0];
    return { ok: true, pedido: filaPedido_(r, sh.getRange(fila, C['Comprobante'] + 1).getRichTextValue()) };
  } finally {
    lock.releaseLock();
  }
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
    `Lectura automática de la foto: ${p.lectura}`,
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
  if (enc.join('|') !== COLS.join('|')) {
    // si solo faltan columnas nuevas al final, se agregan sin tocar los pedidos que ya hay
    const n = enc.indexOf('');
    const soloFaltan = n > 0 && enc.slice(0, n).join('|') === COLS.slice(0, n).join('|') && enc.slice(n).every(v => v === '');
    if (soloFaltan) agregarCols_(sh, n); else preparar_(sh);
  }
  return sh;
}

function agregarCols_(sh, desde) {
  sh.getRange(1, desde + 1, 1, COLS.length - desde).setValues([COLS.slice(desde)])
    .setFontWeight('bold').setBackground('#1E66F5').setFontColor('#FFFFFF');
  if (C['Comprobante leído'] >= desde) {
    sh.setColumnWidth(C['Comprobante leído'] + 1, 280);
    sh.getRange(2, C['Comprobante leído'] + 1, Math.max(1, sh.getMaxRows() - 1), 1).setWrap(true);
  }
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
  sh.setColumnWidth(C['Comprobante leído'] + 1, 280);
  sh.getRange(2, C['Comprobante leído'] + 1, filas, 1).setWrap(true);
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
  // la hoja en español separa los argumentos con ";" en vez de ","; se prueba cuál acepta
  const prueba = sh.getRange('Z1');
  prueba.setFormula('=SUM(1,2)'); SpreadsheetApp.flush();
  const sep = prueba.getValue() === 3 ? ',' : ';';
  prueba.clearContent();
  const f = x => sep === ',' ? x : x.replace(/,/g, ';');
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
  sh.getRange(1, 1, filas.length, 1).setValues(filas.map(f => [f[0]]));
  sh.getRange(4, 2).setValue('Valor');
  sh.getRange(5, 2, filas.length - 4, 1).setFormulas(filas.slice(4).map(r => [f(r[1])]));
  const t0 = filas.length + 2;
  sh.getRange(t0, 1, 1, 5).setValues([['Pedidos por estado', 'Pedidos', 'Total', 'Abono', 'Saldo']]);
  sh.getRange(t0 + 1, 1, ESTADOS.length, 1).setValues(ESTADOS.map(e => [e]));
  sh.getRange(t0 + 1, 2, ESTADOS.length, 4).setFormulas(ESTADOS.map(e => [
    `=COUNTIF(${E},"${e}")`, `=SUMIF(${E},"${e}",${R('Total')})`, `=SUMIF(${E},"${e}",${R('Abono')})`, `=SUMIF(${E},"${e}",${R('Saldo')})`].map(f)));

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
