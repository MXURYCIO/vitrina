/**
 * Tienda Online · Recepción de pedidos
 *
 * Proyecto de Apps Script de la tienda. La primera vez que se ejecuta "configurar" crea en tu
 * Google Drive la carpeta "Tienda Online" con la hoja "Tienda Online · Pedidos" y la carpeta "Comprobantes".
 * Recibe cada pedido de la tienda, guarda la foto del comprobante en Drive,
 * escribe una fila en la hoja, marca alertas y envía un correo de aviso.
 * También responde el seguimiento de pedidos (código + últimos 4 del celular).
 */

// Versión de este programa. La página de revisión avisa si en Google quedó una versión anterior.
const VERSION = '2026-11-21';

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
  MAX_CARRITOS_POR_HORA: 60,
  ZONA_LOCAL: ['La Maná', 'Guasaganda', 'Pucayacu'], // donde se entrega directamente; lo demás va por servicio de entrega
  CUENTA_DESTINO: '2216883431',                       // cuenta donde depositan (la misma que muestra la tienda)
  TITULAR_CLAVES: ['Yomaira', 'Moreira Litardo']      // partes del nombre del titular que pueden salir en el comprobante
};

const ENVIO_WA = 'Carrito compartido';
const COLS = ['Fecha', 'Código', 'Estado', 'Nombre', 'Apellido', 'Cédula', 'Celular', 'Ciudad/cantón', 'Dirección', 'Envío', 'Productos', 'Foto artículo', 'Tienda', 'Códigos',
  'Total', 'Abono', 'Saldo', 'N.º comprobante', 'Monto depositado', 'Comprobante', 'Alertas',
  'Aceptó condiciones', 'Huella foto', 'Comprobante leído', 'Proveedor'];
const C = Object.fromEntries(COLS.map((c, i) => [c, i]));
const ESTADOS = ['Pendiente', 'Aprobado', 'En camino', 'Entregado', 'Rechazado'];
const ESTADO_KEY = { 'Pendiente': 'pendiente', 'Aprobado': 'aprobado', 'En camino': 'camino', 'Entregado': 'entregado', 'Rechazado': 'rechazado' };

/* ---------- Entradas web ---------- */
function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'Solicitud inválida.' }); }
  try {
    if (d.action === 'order') return out_(crearPedido_(d));
    if (d.action === 'carrito') return out_(carritoWhatsapp_(d));
    if (d.action === 'visita') return out_(visita_(d));
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
  return out_({ ok: true, tienda: 'Tienda Online', version: VERSION });
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
  try { completarPedidos(); } catch (err) { console.error(err); }
  console.log('Hoja de pedidos: ' + ss.getUrl());
  return ss.getUrl();
}

/* Artículos del carrito con los precios del catálogo publicado, nunca los que manda el navegador (que se pueden manipular). */
function armarItems_(d) {
  const t = s => String(s == null ? '' : s).trim();
  const catalogo = catalogo_();
  if (!catalogo) return { ok: false, error: 'No pudimos verificar los precios. Intenta de nuevo en un momento.' };
  const est = estados_();
  // una línea por producto y opción elegida (el mismo adorno en rojo y en azul son dos líneas)
  const pedidos = {};
  d.items.slice(0, 30).forEach(it => {
    const id = t(it.id);
    if (!id) return;
    const opcion = t(it.opcion).slice(0, 120);
    const k = id + '|' + opcion;
    if (!pedidos[k]) pedidos[k] = { id, opcion, qty: 0 };
    pedidos[k].qty = Math.min(20, pedidos[k].qty + Math.max(1, Math.floor(Number(it.qty) || 1)));
  });
  const items = [], faltan = [], sinElegir = [];
  Object.values(pedidos).forEach(({ id, opcion, qty }) => {
    const p = catalogo[id];
    if (!p || !(Number(p.price) > 0) || (est[id] || p.status || 'aprobado') !== 'aprobado') { faltan.push(p ? p.name : id); return; }
    const op = opcionValida_(p, opcion);
    if (op === null) { sinElegir.push(`${p.name} (${gruposOpcion_(p).map(g => String(g.nombre).toLowerCase()).join(' y ')})`); return; }
    items.push({ id, qty, name: p.name, opcion: op, price: Number(p.price), foto: fotoUrl_(p, op), pedir: p.pedir || null });
  });
  if (faltan.length) return { ok: false, code: 'catalogo', error: `Ya no está disponible: ${[...new Set(faltan)].join(', ')}. Quítalo del carrito para continuar.` };
  if (sinElegir.length) return { ok: false, code: 'catalogo', error: `Falta elegir: ${[...new Set(sinElegir)].join(', ')}. Elígelo en el carrito para continuar.` };
  if (!items.length) return { ok: false, error: 'El carrito está vacío.' };
  const total = r2_(items.reduce((s, i) => s + i.price * i.qty, 0));
  const abono = r2_(total * CONFIG.ABONO);
  // si el total que vio la clienta no coincide (precio cambiado o manipulado), no se registra el pedido
  if (d.total != null && Math.abs(Number(d.total) - total) > 0.009) {
    return { ok: false, code: 'catalogo', error: `Los precios se actualizaron. El total correcto es ${fmt_(total)} y el abono ${fmt_(abono)}. Revisa tu carrito.` };
  }

  return { ok: true, items, total, abono };
}

/* ---------- Carrito enviado por WhatsApp ----------
 * La clienta arma su carrito y lo envía por WhatsApp; el abono se coordina por chat. Aquí solo se registra el carrito
 * con un código en la hoja "Pedidos" (sin datos personales), con la foto y la tienda de cada artículo, para tener el resumen. */
function carritoWhatsapp_(d) {
  if (!Array.isArray(d.items) || !d.items.length) return { ok: false, error: 'El carrito está vacío.' };
  const cache = CacheService.getScriptCache();
  const kHora = 'carritos_hora';
  const enHora = Number(cache.get(kHora) || 0);
  if (enHora >= CONFIG.MAX_CARRITOS_POR_HORA) return { ok: false, error: 'Estamos recibiendo muchos pedidos. Intenta de nuevo en unos minutos.' };
  const v = armarItems_(d);
  if (!v.ok) return v;
  const { items, total, abono } = v;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = hoja_();
    const n = sh.getLastRow() - 1;
    const filas = n > 0 ? sh.getRange(2, 1, n, COLS.length).getValues() : [];
    const codigos = new Set(filas.map(r => r[C['Código']]));
    // el código lo propone la página (va en el mensaje de WhatsApp); si ya existe como carrito, no se repite la fila
    let code = String(d.code || '').toUpperCase().trim();
    const previo = filas.find(r => r[C['Código']] === code);
    if (previo && previo[C['Envío']] === ENVIO_WA) return { ok: true, code, total: Number(previo[C['Total']]), abono: Number(previo[C['Abono']]), status: 'pendiente', repetido: true };
    if (!/^PED-[A-Z0-9]{4}$/.test(code) || codigos.has(code)) { do { code = 'PED-' + aleatorio_(4); } while (codigos.has(code)); }
    const ahora = new Date();
    const proveedor = proveedorTexto_(items);
    const val = {
      'Fecha': ahora, 'Código': code, 'Estado': 'Pendiente', 'Envío': ENVIO_WA,
      'Productos': items.map(i => `${i.qty} x ${nombreItem_(i)}`).join('\n'), 'Foto artículo': '', 'Tienda': '',
      'Códigos': items.map(codigoItem_).join(', '), 'Total': total, 'Abono': abono, 'Saldo': r2_(total - abono),
      'Comprobante leído': 'Pedido por WhatsApp: el abono y los datos de entrega se coordinan por chat', 'Proveedor': proveedor
    };
    sh.appendRow(COLS.map(c => val[c] != null ? val[c] : ''));
    const r = sh.getLastRow();
    try { escribirArticulos_(sh, r, items); } catch (err) { console.error(err); }
    sh.getRange(r, 1, 1, COLS.length).setBackground('#E7F6EE');
    cache.put(kHora, String(enHora + 1), 3600);
    avisarCarrito_({ code, items, total, abono, proveedor });
    return { ok: true, code, total, abono, status: 'pendiente', date: ahora.toISOString() };
  } finally {
    lock.releaseLock();
  }
}

function avisarCarrito_(p) {
  const para = CONFIG.CORREO_AVISOS || Session.getEffectiveUser().getEmail();
  if (!para) return;
  try {
    const h = x => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    let mapa = {};
    try { mapa = origenMapa_(); } catch (e) {}
    const filas = p.items.map(i => {
      const o = origenItem_(mapa, i);
      const tienda = o ? `${o.url ? `<a href="${h(o.url)}">${h(o.tienda)}</a>` : h(o.tienda)}${o.ref ? ' · ' + h(o.ref) : ''}${o.contacto ? '<br>Contacto: ' + h(o.contacto) : ''}` : 'tienda sin dato';
      return `<tr><td style="padding:6px 10px 6px 0">${i.foto ? `<img src="${h(i.foto)}" width="90" height="90" style="object-fit:cover;border-radius:8px" alt="">` : ''}</td>` +
        `<td style="padding:6px 0;font:14px Arial,sans-serif"><b>${i.qty} x ${h(i.name)}</b> (${h(i.id)})${i.opcion ? `<br><b style="color:#1E66F5">${h(i.opcion)}</b>` : ''}` +
        `<br>${fmt_(i.price * i.qty)}<br>Pedir en: ${tienda}</td></tr>`;
    }).join('');
    const cuerpo = [`Carrito enviado por WhatsApp ${p.code}`, '', ...p.items.map(i => `${i.qty} x ${nombreItem_(i)}   ${fmt_(i.price * i.qty)}`), '',
      `Total: ${fmt_(p.total)}`, `Abono (50%): ${fmt_(p.abono)}`, '', 'Dónde pedir cada producto:', p.proveedor, '', `Hoja de pedidos: ${libro_().getUrl()}`].join('\n');
    MailApp.sendEmail({ to: para, subject: `Pedido por WhatsApp ${p.code} · ${fmt_(p.total)}`, body: cuerpo,
      htmlBody: `<div style="font:14px Arial,sans-serif">${h(cuerpo).replace(/\n/g, '<br>')}</div><h3 style="font:bold 15px Arial,sans-serif;margin:18px 0 6px">Artículos</h3><table style="border-collapse:collapse">${filas}</table>` });
  } catch (err) { console.error(err); }
}

/* ---------- Pedidos ---------- */
function crearPedido_(d) {
  const t = s => String(s == null ? '' : s).trim();
  // la página pide un solo campo "Nombre y apellido": se separa aquí (2-3 palabras: nombre + apellidos; 4 o más: mitad y mitad)
  let nombre = t(d.name).replace(/\s+/g, ' ').slice(0, 80), apellido = t(d.last).replace(/\s+/g, ' ').slice(0, 60);
  if (!apellido) {
    const w = nombre.split(' ');
    const k = w.length >= 4 ? Math.floor(w.length / 2) : 1;
    if (w.length > 1) { nombre = w.slice(0, k).join(' '); apellido = w.slice(k).join(' '); }
  }
  const cedula = t(d.cedula), cel = t(d.phone);
  const ciudad = t(d.city).replace(/\s+/g, ' ').slice(0, 60), direccion = t(d.address).replace(/\s+/g, ' ').slice(0, 200);
  let num = t(d.receipt && d.receipt.num).slice(0, 40);   // opcionales: si no vienen, se leen de la foto
  const monto = Number(d.receipt && d.receipt.amount);

  if (nombre.length < 2) return { ok: false, error: 'Falta tu nombre.' };
  if (cedula && !cedulaOk_(cedula)) return { ok: false, error: 'La cédula no es válida.' };
  if (!/^09\d{8}$/.test(cel)) return { ok: false, error: 'El celular no es válido.' };
  if (ciudad.length < 3) return { ok: false, error: 'Falta la ciudad o cantón de entrega.' };
  if (direccion.length < 5) return { ok: false, error: 'Falta la dirección de entrega.' };
  const envio = esLocal_(ciudad) ? 'Local' : 'Servicio de entrega (costo aparte)';
  if (!Array.isArray(d.items) || !d.items.length) return { ok: false, error: 'El carrito está vacío.' };
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

  const v = armarItems_(d);
  if (!v.ok) return v;
  const { items, total, abono } = v;

  const b64 = d.photo.slice(d.photo.indexOf(',') + 1);
  const mime = d.photo.slice(5, d.photo.indexOf(';'));
  const bytes = Utilities.base64Decode(b64);
  if (bytes.length > 6 * 1024 * 1024) return { ok: false, error: 'La foto del comprobante es muy pesada.' };
  const huella = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes));
  // lectura automática de la foto: monto, cuenta de destino y número de comprobante (antes del candado, porque tarda unos segundos)
  const lectura = leerComprobante_(bytes, mime, monto, abono, num, total);
  if (!num && lectura.numero) num = lectura.numero;

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
      if (numNorm && String(r[C['N.º comprobante']]).replace(/\s/g, '').toUpperCase() === numNorm) alertas.push(`N.º de comprobante ya usado en ${r[C['Código']]}`);
      if (r[C['Huella foto']] && r[C['Huella foto']] === huella) alertas.push(`Misma foto que ${r[C['Código']]}`);
    });
    // el monto que escribió la clienta solo cuenta si la foto no muestra ya un pago completo
    if (monto > 0 && monto + 0.005 < abono && !(lectura.pagado + 0.005 >= abono)) alertas.push(`Monto ${fmt_(monto)} menor al abono ${fmt_(abono)}`);
    lectura.alertas.forEach(a => alertas.push(a));

    const ahora = new Date();
    const proveedor = proveedorTexto_(items);
    const v = {
      'Fecha': ahora, 'Código': code, 'Estado': 'Pendiente', 'Nombre': texto_(nombre), 'Apellido': texto_(apellido),
      'Cédula': cedula ? "'" + cedula : '', 'Celular': "'" + cel, 'Ciudad/cantón': texto_(ciudad), 'Dirección': texto_(direccion), 'Envío': envio,
      'Productos': items.map(i => `${i.qty} x ${nombreItem_(i)}`).join('\n'), 'Foto artículo': '', 'Tienda': '',
      'Códigos': items.map(codigoItem_).join(', '),
      'Total': total, 'Abono': abono, 'Saldo': r2_(total - abono), 'N.º comprobante': num ? "'" + num : '', 'Monto depositado': monto > 0 ? monto : (lectura.pagado > 0 ? lectura.pagado : ''),
      'Comprobante': 'Ver foto', 'Alertas': alertas.join(' · '), 'Aceptó condiciones': ahora, 'Huella foto': huella,
      'Comprobante leído': lectura.resumen, 'Proveedor': proveedor
    };
    sh.appendRow(COLS.map(c => v[c]));
    const r = sh.getLastRow();
    sh.getRange(r, C['Comprobante'] + 1).setRichTextValue(
      SpreadsheetApp.newRichTextValue().setText('Ver foto').setLinkUrl(archivo.getUrl()).build());
    try { escribirArticulos_(sh, r, items); } catch (err) { console.error(err); }
    if (alertas.length) sh.getRange(r, 1, 1, COLS.length).setBackground('#FDE2E2');

    cache.put(kCel, String(usados + 1), 3600);
    cache.put(kHora, String(Number(cache.get(kHora) || 0) + 1), 3600);
    avisar_({ code, nombre, apellido, cel, ciudad, direccion, envio, items, total, abono, num, monto, archivo, alertas, lectura: lectura.resumen, proveedor });
    return { ok: true, code, total, abono, status: 'pendiente', date: ahora.toISOString() };
  } finally {
    lock.releaseLock();
  }
}

/* ---------- Lectura automática del comprobante ----------
 * Convierte la foto en texto con el lector de Google Drive y revisa tres cosas:
 * que se vea el pago (el monto que escribió la clienta, el abono o el total), que no sea menor al abono
 * y que se vea la cuenta (o el nombre) de destino.
 * Nunca rechaza el pedido: solo agrega alertas para que la dueña lo revise antes de aprobar. */
function leerComprobante_(bytes, mime, monto, abono, num, total) {
  return analizarComprobante_(ocrTexto_(bytes, mime), monto, abono, num, total);
}

function ocrTexto_(bytes, mime) {
  let texto = '', id = null;
  try {
    const blob = Utilities.newBlob(bytes, mime, 'comprobante');
    if (typeof Drive.Files.create === 'function') {
      // servicio avanzado de Drive, versión 3
      id = Drive.Files.create({ name: 'lectura-comprobante-temporal', mimeType: 'application/vnd.google-apps.document' },
        blob, { ocrLanguage: 'es', fields: 'id' }).id;
    } else {
      // versión 2 del mismo servicio
      id = Drive.Files.insert({ title: 'lectura-comprobante-temporal', mimeType: mime }, blob, { ocr: true, ocrLanguage: 'es' }).id;
    }
    const res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '/export?mimeType=text%2Fplain',
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (res.getResponseCode() === 200) texto = res.getContentText();
    else console.error('Lectura del comprobante: ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 300));
  } catch (err) {
    console.error(err);
  } finally {
    if (id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { try { Drive.Files.remove(id); } catch (e2) {} } }
  }
  return texto;
}

// Valores posibles de un número escrito con decimales: "1.234,56", "1,234.56", "12,50", "12.5".
// El primero es la lectura normal. Con tres cifras después del separador ("4,500") también se prueba
// como decimal con un dígito de más (4,50), porque la marca de agua del banco pegada al monto
// a veces se lee como un 0 extra.
function numeros_(raw) {
  const k = Math.max(raw.lastIndexOf('.'), raw.lastIndexOf(','));
  if (k < 0) return [Number(raw)];
  const ent = raw.slice(0, k).replace(/[.,]/g, ''), dec = raw.slice(k + 1);
  const decimal = Number(ent + '.' + dec.slice(0, 2));
  if (dec.length === 3) return [Number(ent + dec), decimal]; // "1.000" es mil, pero "4,500" puede ser 4,50
  return [decimal];
}

function analizarComprobante_(texto, monto, abono, num, total) {
  const t = String(texto || '').replace(/\u00a0/g, ' ');
  const out = { texto: t, alertas: [], resumen: '', pagado: 0 };
  if (!t.replace(/\s/g, '')) {
    out.alertas.push('No se pudo leer la foto del comprobante');
    out.resumen = 'No se pudo leer la foto';
    return out;
  }
  // el lector a veces separa los decimales o confunde la O con el cero: "10 , 00", "$ 1O.00"
  const n = t.replace(/(\d)[oO](?=\d|[.,]\d)/g, '$10').replace(/(\d[.,]\d)[oO](?![a-z\d])/gi, '$10')
    .replace(/(\d)\s*([.,])\s*(\d{2})(?!\d)/g, '$1$2$3')
    .replace(/(\$|usd|us\$)\s+(?=\d)/gi, '$1');
  const montos = [];
  // con decimales: "$5,00", "USD 12.50", "1.234,56", "12,5"
  const re = /(\$|usd|us\$)?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d{1,6}[.,]\d{1,2})(?![\d])/gi;
  let m;
  while ((m = re.exec(n))) {
    const [v, ...otros] = numeros_(m[2]);
    if (v > 0 && v < 100000) montos.push({ v, signo: !!m[1], otros });
  }
  // sin decimales pero con signo o palabra de monto: "$20", "Monto: 20", "Valor 15 USD"
  const re2 = /(?:\$|usd|us\$|monto|valor|importe|total|cantidad|transferido|depositado)[:\s]*(\d{1,6})(?!\d|[.,]\d)/gi;
  while ((m = re2.exec(n))) {
    const v = Number(m[1]);
    if (v > 0 && v < 100000) montos.push({ v, signo: true, otros: [] });
  }
  const conSigno = montos.filter(x => x.signo).map(x => x.v);
  // para comparar con lo esperado también cuentan las otras lecturas posibles de cada número
  const todos = montos.flatMap(x => [x.v, ...x.otros]);
  const lista = [...new Set(conSigno.length ? conSigno : montos.map(x => x.v))];
  const cerca = (a, b) => Math.abs(a - b) < 0.006;
  // búsqueda directa de cada valor esperado en el texto, por si el número quedó pegado a otras palabras
  const compacto = n.replace(/\s/g, '');
  const aparece = v => {
    const f = v.toFixed(2), formas = [f, f.replace('.', ','), v.toFixed(2).replace(/0$/, '').replace(/[.,]$/, '')];
    if (Number.isInteger(v)) formas.push('$' + v, v + ',0', v + '.0');
    return formas.some(x => new RegExp('(^|[^\\d.,])' + x.replace(/[.$]/g, '\\$&') + '(?![.,]?\\d)').test(compacto));
  };
  const esperados = [...new Set([monto, abono, total].map(Number).filter(v => v > 0))];
  const vistos = esperados.filter(v => todos.some(x => cerca(x, v)) || aparece(v));
  out.pagado = vistos.length ? Math.max(...vistos) : 0;
  const digitos = t.replace(/\D/g, '');
  const plano = sinTildes_(t);

  if (!vistos.length) {
    if (!lista.length) out.alertas.push('No se encontró el monto en el comprobante');
    else out.alertas.push(`El comprobante no muestra ${fmt_(monto || abono)} (se leyó ${lista.slice(0, 3).map(fmt_).join(', ')})`);
    if (lista.length && Math.max(...lista) + 0.005 < abono) out.alertas.push(`El comprobante muestra ${fmt_(Math.max(...lista))}, menos que el abono ${fmt_(abono)}`);
  } else if (out.pagado + 0.005 < abono) {
    out.alertas.push(`El comprobante muestra ${fmt_(out.pagado)}, menos que el abono ${fmt_(abono)}`);
  }
  const ult4 = CONFIG.CUENTA_DESTINO.slice(-4);
  const cuentaOk = digitos.includes(ult4) || CONFIG.TITULAR_CLAVES.some(k => plano.includes(sinTildes_(k)));
  if (!cuentaOk) out.alertas.push(`No se ve la cuenta de destino (termina en ${ult4}) ni el nombre del titular`);
  const nd = String(num || '').replace(/\D/g, '');
  const numOk = nd.length >= 4 && digitos.includes(nd);
  // si la clienta no escribió el número, se toma el que aparece junto a "comprobante", "transacción", "referencia" o "documento"
  if (!nd) {
    const conEspacios = String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const m = conEspacios.match(/(?:comprobante|transaccion|referencia|documento|operacion)[^0-9\n]{0,25}(\d{6,14})(?!\d)/);
    if (m) out.numero = m[1];
  }
  if (nd.length >= 4 && !numOk) out.alertas.push(`El N.º de comprobante ${num} no aparece en la foto`);
  const leido = vistos.length ? `${fmt_(out.pagado)} (coincide)` : lista.length ? lista.slice(0, 3).map(fmt_).join(', ') : 'no se encontró';
  out.resumen = `Monto leído: ${leido} · Cuenta destino: ${cuentaOk ? 'sí' : 'no'} · N.º: ${numOk ? 'sí' : out.numero ? out.numero + ' (leído)' : 'no'}`;
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
  try {
    return Object.assign(adminOp_(d), { version: VERSION });
  } catch (err) {
    console.error(err);
    return { ok: false, version: VERSION, error: 'Error en Google: ' + String(err && err.message || err).slice(0, 200) };
  }
}

function adminOp_(d) {
  if (d.op === 'revision') return { ok: true, revision: leerRev_(), llave: PropertiesService.getScriptProperties().getProperty('COSTOS_LLAVE') || '' };
  if (d.op === 'pedidos') return buscarPedidos_(String(d.q || ''));
  if (d.op === 'estado') return cambiarEstado_(String(d.code || ''), String(d.estado || ''));
  if (d.op === 'leer') {
    // prueba de la lectura automática sin crear pedido
    if (!d.photo || !/^data:image\/(jpeg|png|webp);base64,/.test(d.photo)) return { ok: false, error: 'Falta la foto.' };
    const bytes = Utilities.base64Decode(d.photo.slice(d.photo.indexOf(',') + 1));
    const l = leerComprobante_(bytes, d.photo.slice(5, d.photo.indexOf(';')), Number(d.monto), Number(d.abono || d.monto), String(d.num || ''), Number(d.total || 0));
    return { ok: true, resumen: l.resumen, alertas: l.alertas, texto: l.texto.slice(0, 600) };
  }
  if (d.op === 'decidir') return decidir_(d);
  if (d.op === 'visitas') return resumenVisitas_(Number(d.dias) || 1);
  if (d.op === 'origen') return guardarOrigen_(d.mapa);
  if (d.op === 'releer') return releer_(String(d.code || ''));
  return { ok: false, error: 'Acción desconocida.' };
}

/* ---------- Proveedor de cada producto (solo dueño) ----------
 * El canal de Telegram y el número de publicación de cada producto van cifrados en origen.json
 * (el repositorio es público). La página de revisión los descifra con el PIN y los manda aquí;
 * se guardan en la hoja "Proveedores" para anotar en cada pedido dónde pedir cada producto. */
const PROV_COLS = ['ID', 'Producto', 'Tienda', 'Canal', 'Publicación', 'Enlace', 'Actualizado'];

function guardarOrigen_(mapa) {
  if (!mapa || typeof mapa !== 'object') return { ok: false, error: 'Sin datos.' };
  const cat = catalogo_() || {};
  const filas = [];
  Object.keys(mapa).slice(0, 3000).forEach(id => {
    if (!/^[A-Z]{1,4}-\d{1,6}$/.test(id)) return;
    const m = String(mapa[id] || '').match(/^([^|]{1,60})\|([A-Za-z0-9_]{3,40})\/(\d{1,9})$/);
    if (!m) return;
    filas.push([id, texto_(cat[id] ? String(cat[id].name) : ''), texto_(m[1]), m[2], m[3], `https://t.me/${m[2]}/${m[3]}`, new Date()]);
  });
  if (!filas.length) return { ok: false, error: 'Sin datos válidos.' };
  filas.sort((a, b) => Number(a[0].split('-')[1]) - Number(b[0].split('-')[1]));
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = hojaProv_();
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, PROV_COLS.length).clearContent();
    sh.getRange(2, 1, filas.length, PROV_COLS.length).setValues(filas);
    CacheService.getScriptCache().remove('origen');
  } finally {
    lock.releaseLock();
  }
  // con la lista de tiendas al día, completa la foto y la tienda de los pedidos que no la tienen
  let completados = 0;
  try { completados = completarPedidos(); } catch (err) { console.error(err); }
  return { ok: true, n: filas.length, completados };
}

function hojaProv_() {
  const ss = libro_();
  let sh = ss.getSheetByName('Proveedores');
  if (!sh) {
    sh = ss.insertSheet('Proveedores');
    sh.getRange(1, 1, 1, PROV_COLS.length).setValues([PROV_COLS]).setFontWeight('bold').setBackground('#1E66F5').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    sh.setColumnWidth(2, 280);
    sh.setColumnWidth(6, 260);
    sh.getRange(2, 7, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('dd/mm/yyyy hh:mm');
  }
  return sh;
}

// { 'P-216': { tienda, canal, num, url } }
function origenMapa_() {
  const cache = CacheService.getScriptCache();
  const c = cache.get('origen');
  if (c) { try { return JSON.parse(c); } catch (e) {} }
  const sh = hojaProv_();
  const out = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues().forEach(r => {
      if (r[0]) out[String(r[0])] = { tienda: String(r[2]), canal: String(r[3]), num: String(r[4]), url: String(r[5]) };
    });
  }
  const txt = JSON.stringify(out);
  if (txt.length < 95000) cache.put('origen', txt, 21600);
  return out;
}

function proveedorTexto_(items) {
  let mapa = {};
  try { mapa = origenMapa_(); } catch (e) { console.error(e); }
  return items.map(i => {
    const o = origenItem_(mapa, i), ini = `${i.id} x${i.qty}${i.opcion ? ` (${i.opcion})` : ''}`;
    return o ? `${ini}: ${o.tienda}${o.ref ? ' · ' + o.ref : ''}${o.contacto ? ' · tel. ' + o.contacto : ''}${o.url ? ' · ' + o.url : ''}` : `${ini}: sin dato`;
  }).join('\n');
}

/* ---------- Opciones a elegir (color, modelo, diseño...) ----------
 * En products.json un producto puede traer "opciones": [{"nombre": "Color", "valores": ["Rojo", "Azul"], "fotos": [0, 2]}]
 * ("fotos" es opcional: qué foto del producto muestra cada valor). La clienta debe elegir un valor de cada grupo.
 * La elección viaja como texto "Color: Rojo · Modelo: Caballos". */
function gruposOpcion_(p) {
  return (p && Array.isArray(p.opciones) ? p.opciones : []).filter(g => g && g.nombre && Array.isArray(g.valores) && g.valores.length > 1);
}

// Devuelve la elección escrita como en el catálogo, '' si el producto no tiene opciones, o null si falta elegir o no vale.
function opcionValida_(p, raw) {
  const grupos = gruposOpcion_(p);
  if (!grupos.length) return '';
  const elegido = {};
  String(raw || '').split('·').forEach(par => {
    const k = par.indexOf(':');
    if (k > 0) elegido[sinTildes_(par.slice(0, k))] = sinTildes_(par.slice(k + 1));
  });
  const partes = [];
  for (const g of grupos) {
    const v = g.valores.find(x => sinTildes_(x) === elegido[sinTildes_(g.nombre)]);
    if (!v) return null;
    partes.push(`${g.nombre}: ${v}`);
  }
  return partes.join(' · ');
}

// Foto del valor elegido (si el catálogo indica cuál es), para que en la hoja y el correo se vea el color o modelo pedido.
function fotoOpcion_(p, opcion) {
  if (!opcion || !p || !Array.isArray(p.imgs)) return '';
  const partes = String(opcion).split('·').map(s => s.trim());
  for (const g of gruposOpcion_(p)) {
    if (!Array.isArray(g.fotos)) continue;
    const par = partes.find(s => sinTildes_(s.slice(0, s.indexOf(':'))) === sinTildes_(g.nombre));
    if (!par) continue;
    const i = g.valores.findIndex(v => sinTildes_(v) === sinTildes_(par.slice(par.indexOf(':') + 1)));
    const k = i >= 0 ? g.fotos[i] : null;
    if (k != null && p.imgs[k]) return p.imgs[k];
  }
  return '';
}

const nombreItem_ = i => i.opcion ? `${i.name} (${i.opcion})` : i.name;
const codigoItem_ = i => `${i.id} x${i.qty}${i.opcion ? ` [${i.opcion}]` : ''}`;
// "P-216 x2 [Color: Rojo]" → { id, qty, opcion }
function leerCodigo_(s) {
  const m = String(s).trim().match(/^(\S+)\s+x(\d+)(?:\s*\[([^\]]*)\])?$/);
  return m ? { id: m[1], qty: Number(m[2]), opcion: m[3] || '' } : null;
}
function codigosDeFila_(r) {
  // la opción va entre corchetes y nunca lleva comas, así que se puede separar por comas
  return String(r[C['Códigos']] || '').split(',').map(leerCodigo_).filter(Boolean);
}

/* ---------- Foto y tienda de cada artículo en la hoja de pedidos ----------
 * "Foto artículo" muestra la foto del producto pedido (la del primero si son varios).
 * "Tienda" dice en qué tienda de Telegram pedir cada artículo, con enlace a la publicación y a la foto. */
const BASE_TIENDA_ = CONFIG.PRODUCTOS_URL.replace(/products\.json$/, '');
function fotoUrl_(p, opcion) {
  const rel = fotoOpcion_(p, opcion) || (p && (p.thumb || (Array.isArray(p.imgs) && p.imgs[0])));
  return rel ? (/^https?:/.test(rel) ? rel : BASE_TIENDA_ + rel) : '';
}

function escribirArticulos_(sh, fila, items, mapa) {
  if (!mapa) { mapa = {}; try { mapa = origenMapa_(); } catch (e) { console.error(e); } }
  const conFoto = items.find(i => i.foto);
  const celdaFoto = sh.getRange(fila, C['Foto artículo'] + 1);
  if (conFoto) celdaFoto.setFormula(`=IMAGE("${conFoto.foto}")`); else celdaFoto.setValue('Sin foto');
  // texto con enlaces: "1 x Producto (P-216): Tienda · publicación 123 · ver foto"
  let texto = '';
  const enlaces = [];
  items.forEach((i, k) => {
    if (k) texto += '\n';
    texto += `${i.qty} x ${nombreItem_(i)} (${i.id}): `;
    const o = origenItem_(mapa, i);
    if (o) {
      const a = texto.length; texto += o.tienda; if (o.url) enlaces.push([a, texto.length, o.url]);
      if (o.ref) texto += ` · ${o.ref}`;
      if (o.contacto) texto += ` · tel. ${o.contacto}`;
    } else {
      texto += 'tienda sin dato';
    }
    if (i.foto) { texto += ' · '; const a = texto.length; texto += 'ver foto'; enlaces.push([a, texto.length, i.foto]); }
  });
  const rt = SpreadsheetApp.newRichTextValue().setText(texto);
  enlaces.forEach(([a, b, url]) => { if (url) rt.setLinkUrl(a, b, url); });
  sh.getRange(fila, C['Tienda'] + 1).setRichTextValue(rt.build()).setWrap(true).setVerticalAlignment('middle');
  if (sh.getRowHeight(fila) < 96) sh.setRowHeight(fila, 96);
}

function itemsDeFila_(r, cat) {
  const lineas = String(r[C['Productos']] || '').split('\n');
  return codigosDeFila_(r).map((x, k) => {
    const p = cat[x.id];
    const nombre = p ? String(p.name) : String(lineas[k] || '').replace(/^\d+\s*x\s*/, '').replace(/\s*\([^()]*:[^()]*\)$/, '') || x.id;
    return { id: x.id, qty: x.qty, opcion: x.opcion, name: nombre, foto: fotoUrl_(p, x.opcion), pedir: p ? p.pedir || null : null };
  });
}

/* Completa "Foto artículo", "Tienda" y "Proveedor" en los pedidos que no los tienen (también los anteriores a este cambio).
 * Se ejecuta sola al abrir la página de revisión con el PIN; también se puede ejecutar a mano desde el editor. */
function completarPedidos() {
  const cat = catalogo_();
  if (!cat) return 0;
  let mapa = {};
  try { mapa = origenMapa_(); } catch (e) { console.error(e); }
  const sh = hoja_();
  const n = sh.getLastRow() - 1;
  if (n < 1) return 0;
  const vals = sh.getRange(2, 1, n, COLS.length).getValues();
  const forms = sh.getRange(2, C['Foto artículo'] + 1, n, 1).getFormulas();
  let hechos = 0;
  for (let i = 0; i < n && hechos < 150; i++) {
    const r = vals[i];
    if (!r[C['Código']] || !r[C['Códigos']]) continue;
    const tienda = String(r[C['Tienda']] || '');
    const falta = !forms[i][0] && r[C['Foto artículo']] !== 'Sin foto' || !tienda || /sin dato/.test(tienda);
    if (!falta) continue;
    const items = itemsDeFila_(r, cat);
    if (!items.length) continue;
    escribirArticulos_(sh, i + 2, items, mapa);
    if (!r[C['Proveedor']] || /sin dato/.test(String(r[C['Proveedor']]))) sh.getRange(i + 2, C['Proveedor'] + 1).setValue(proveedorTexto_(items));
    hechos++;
  }
  return hechos;
}

/* Vuelve a leer la foto del comprobante de un pedido con la lectura actual y rehace sus alertas
 * (se conservan las de comprobante repetido). Lo usa el botón "Volver a leer" de la página de revisión. */
function releer_(code) {
  code = code.toUpperCase().trim();
  if (!/^PED-[A-Z0-9]{4}$/.test(code)) return { ok: false, error: 'Código no válido.' };
  const sh = hoja_();
  if (sh.getLastRow() < 2) return { ok: false, error: 'No encontrado.' };
  const celda = sh.getRange(2, C['Código'] + 1, sh.getLastRow() - 1, 1).createTextFinder(code).matchEntireCell(true).findNext();
  if (!celda) return { ok: false, error: 'No encontrado.' };
  const fila = celda.getRow();
  const r = sh.getRange(fila, 1, 1, COLS.length).getValues()[0];
  const rich = sh.getRange(fila, C['Comprobante'] + 1).getRichTextValue();
  const url = rich && rich.getLinkUrl() || '';
  const id = (url.match(/[-\w]{25,}/) || [])[0];
  if (!id) return { ok: false, error: 'No se encontró la foto del comprobante.' };
  const blob = DriveApp.getFileById(id).getBlob();
  const monto = Number(r[C['Monto depositado']]) || 0, abono = Number(r[C['Abono']]) || 0, total = Number(r[C['Total']]) || 0;
  const l = leerComprobante_(blob.getBytes(), blob.getContentType(), monto, abono, String(r[C['N.º comprobante']] || ''), total);
  const alertas = String(r[C['Alertas']] || '').split(' · ').filter(a => /^(N\.º de comprobante ya usado|Misma foto)/.test(a));
  if ((!(monto > 0) || monto + 0.005 < abono) && !(l.pagado + 0.005 >= abono)) alertas.push(`Monto ${fmt_(monto)} menor al abono ${fmt_(abono)}`);
  l.alertas.forEach(a => alertas.push(a));
  sh.getRange(fila, C['Alertas'] + 1).setValue(alertas.join(' · '));
  sh.getRange(fila, C['Comprobante leído'] + 1).setValue(l.resumen);
  sh.getRange(fila, 1, 1, COLS.length).setBackground(alertas.length ? '#FDE2E2' : null);
  const r2 = sh.getRange(fila, 1, 1, COLS.length).getValues()[0];
  return { ok: true, pedido: filaPedido_(r2, rich), texto: l.texto.slice(0, 600) };
}

/* ---------- Visitas de la tienda ----------
 * La tienda manda un aviso al entrar y uno cada minuto mientras la página está abierta.
 * Solo se guardan números anónimos: sin nombres, celulares ni direcciones IP. Una fila por visita. */
const VIS_COLS = ['Visita', 'Visitante', 'Inicio', 'Última actividad', 'Segundos', 'Productos vistos', 'Dispositivo', 'Llegó desde', 'Nueva', 'Carrito'];
const VIS_DEV = ['Celular', 'Computadora', 'Tablet'];
const VIS_REF = ['WhatsApp', 'Facebook', 'Instagram', 'TikTok', 'Google', 'Directo', 'Otro'];

function visita_(d) {
  const sid = String(d.sid || ''), vid = String(d.vid || '');
  if (!/^[a-z0-9]{8,32}$/i.test(sid) || !/^[a-z0-9]{8,32}$/i.test(vid)) return { ok: false };
  const cache = CacheService.getScriptCache();
  const nHora = Number(cache.get('vis_hora') || 0);
  if (nHora > 8000) return { ok: false };
  cache.put('vis_hora', String(nHora + 1), 3600);
  const seg = Math.max(0, Math.min(6 * 3600, Math.round(Number(d.seg) || 0)));
  const ids = (Array.isArray(d.ver) ? d.ver : []).map(String).filter(x => /^[A-Z]{1,4}-\d{1,6}$/.test(x)).slice(0, 40);
  const carrito = Math.max(0, Math.min(999, Math.round(Number(d.carrito) || 0)));
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) return { ok: false };
  try {
    const sh = hojaVis_();
    const ahora = new Date();
    const k = 'vs_' + sid;
    let fila = Number(cache.get(k) || 0);
    if (fila && sh.getRange(fila, 1).getValue() !== sid) fila = 0;
    if (!fila) {
      const last = sh.getLastRow();
      if (last > 1) {
        const n = Math.min(400, last - 1);
        const vals = sh.getRange(last - n + 1, 1, n, 1).getValues();
        for (let i = n - 1; i >= 0; i--) if (vals[i][0] === sid) { fila = last - n + 1 + i; break; }
      }
    }
    if (!fila) {
      const dev = VIS_DEV.includes(d.dev) ? d.dev : 'Celular';
      const ref = VIS_REF.includes(d.ref) ? d.ref : 'Otro';
      sh.appendRow([sid, vid, ahora, ahora, seg, ids.join(' '), dev, ref, d.nueva ? 'Sí' : 'No', carrito]);
      fila = sh.getLastRow();
    } else {
      const r = sh.getRange(fila, 4, 1, 3).getValues()[0];
      const vistos = [...new Set(String(r[2] || '').split(' ').filter(Boolean).concat(ids))].slice(0, 80);
      sh.getRange(fila, 4, 1, 3).setValues([[ahora, Math.max(Number(r[1]) || 0, seg), vistos.join(' ')]]);
      if (carrito) sh.getRange(fila, 10).setValue(carrito);
    }
    cache.put(k, String(fila), 21600);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function hojaVis_() {
  const ss = libro_();
  let sh = ss.getSheetByName('Visitas');
  if (!sh) {
    sh = ss.insertSheet('Visitas');
    sh.getRange(1, 1, 1, VIS_COLS.length).setValues([VIS_COLS]).setFontWeight('bold').setBackground('#1E66F5').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    sh.getRange(2, 3, Math.max(1, sh.getMaxRows() - 1), 2).setNumberFormat('dd/mm/yyyy hh:mm:ss');
    sh.setColumnWidth(6, 260);
  }
  return sh;
}

// Resumen para la página de revisión: en línea ahora, totales del período, por día u hora, productos más vistos, etc.
function resumenVisitas_(dias) {
  dias = [1, 7, 30].includes(dias) ? dias : 1;
  const sh = hojaVis_();
  const last = sh.getLastRow();
  const ahora = Date.now();
  const OFF = 5 * 3600 * 1000; // Ecuador: UTC-5 todo el año
  const dia = t => new Date(t - OFF).toISOString().slice(0, 10);
  const hoy = dia(ahora);
  const keys = [];
  for (let i = dias - 1; i >= 0; i--) keys.push(dia(ahora - i * 86400000));
  const desde = keys[0];
  const filas = last > 1 ? sh.getRange(Math.max(2, last - 40000 + 1), 1, Math.min(40000, last - 1), VIS_COLS.length).getValues() : [];
  const porDia = Object.fromEntries(keys.map(k => [k, { visitantes: new Set(), visitas: 0, seg: 0 }]));
  const porHora = Array(24).fill(0);
  const visitantes = new Set(), nuevos = new Set(), dev = {}, ref = {}, vistos = {};
  let visitas = 0, seg = 0, conProd = 0, conCarrito = 0, cortas = 0, online = 0;
  const recientes = [];
  filas.forEach(r => {
    const ini = r[2] instanceof Date ? r[2].getTime() : new Date(r[2]).getTime();
    const ult = r[3] instanceof Date ? r[3].getTime() : new Date(r[3]).getTime();
    if (!ini) return;
    if (ahora - ult < 3 * 60000) online++;
    const k = dia(ini);
    if (k < desde) return;
    const s = Number(r[4]) || 0, vid = String(r[1]);
    const prods = String(r[5] || '').split(' ').filter(Boolean);
    visitas++; seg += s; visitantes.add(vid);
    if (r[8] === 'Sí') nuevos.add(vid);
    if (prods.length) conProd++;
    if (Number(r[9]) > 0) conCarrito++;
    if (s < 10) cortas++;
    dev[r[6]] = (dev[r[6]] || 0) + 1;
    ref[r[7]] = (ref[r[7]] || 0) + 1;
    prods.forEach(id => { vistos[id] = (vistos[id] || 0) + 1; });
    if (porDia[k]) { porDia[k].visitantes.add(vid); porDia[k].visitas++; porDia[k].seg += s; }
    if (k === hoy) porHora[new Date(ini - OFF).getUTCHours()]++;
    recientes.push({ ini, ult, s, n: prods.length, dev: r[6], ref: r[7], nueva: r[8] === 'Sí', carrito: Number(r[9]) || 0 });
  });
  const hm = t => new Date(t - OFF).toISOString().slice(11, 16);
  const orden = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ k, n }));
  return {
    ok: true, dias, hoy, online,
    visitantes: visitantes.size, visitas, nuevos: nuevos.size,
    promedio: visitas ? Math.round(seg / visitas) : 0, total: seg,
    conProductos: conProd, conCarrito, cortas,
    porDia: keys.map(k => ({ d: k, visitantes: porDia[k].visitantes.size, visitas: porDia[k].visitas, promedio: porDia[k].visitas ? Math.round(porDia[k].seg / porDia[k].visitas) : 0 })),
    porHora: dias === 1 ? porHora : null,
    dispositivos: orden(dev), origen: orden(ref),
    top: orden(vistos).slice(0, 12).map(x => ({ id: x.k, n: x.n })),
    recientes: recientes.slice(-25).reverse().map(x => ({
      dia: dia(x.ini), hora: hm(x.ini), s: x.s, n: x.n, dev: x.dev, ref: x.ref, nueva: x.nueva, carrito: x.carrito, activa: ahora - x.ult < 3 * 60000
    }))
  };
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
  if (!/^PED-[A-Z0-9]{4}$/.test(code) || !(/^\d{4}$/.test(last4) || last4 === '')) return { ok: false, error: 'Datos incompletos.' };
  const sh = hoja_();
  if (sh.getLastRow() < 2) return { ok: false, error: 'No encontrado.' };
  const celda = sh.getRange(2, C['Código'] + 1, sh.getLastRow() - 1, 1).createTextFinder(code).matchEntireCell(true).findNext();
  if (!celda) return { ok: false, error: 'No encontrado.' };
  const r = sh.getRange(celda.getRow(), 1, 1, COLS.length).getValues()[0];
  // pedidos con celular: se piden sus últimos 4 dígitos; los enviados por WhatsApp (sin celular) se consultan solo con el código
  const cel = String(r[C['Celular']] || '').replace(/\D/g, '');
  if (cel ? cel.slice(-4) !== last4 : r[C['Envío']] !== ENVIO_WA) return { ok: false, error: 'No encontrado.' };
  const items = codigosDeFila_(r);
  return {
    ok: true, code, status: ESTADO_KEY[r[C['Estado']]] || 'pendiente',
    date: new Date(r[C['Fecha']]).toISOString(), total: Number(r[C['Total']]), abono: Number(r[C['Abono']]),
    items, lines: String(r[C['Productos']]).split('\n').filter(Boolean), via: r[C['Envío']] === ENVIO_WA ? 'whatsapp' : ''
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
    alertas: String(r[C['Alertas']] || ''), lectura: String(r[C['Comprobante leído']] || ''),
    codigos: String(r[C['Códigos']] || ''), proveedor: String(r[C['Proveedor']] || '')
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
    ...p.items.map(i => `${i.qty} x ${nombreItem_(i)}   ${fmt_(i.price * i.qty)}`),
    '',
    `Total: ${fmt_(p.total)}`,
    `Abono a verificar: ${fmt_(p.abono)}`,
    `Comprobante N.º ${p.num} por ${fmt_(p.monto || 0)}`,
    `Lectura automática de la foto: ${p.lectura}`,
    p.alertas.length ? `Alertas: ${p.alertas.join(' · ')}` : 'Sin alertas.',
    '',
    'Dónde pedir cada producto:',
    p.proveedor || 'Sin dato (abre la página de revisión con tu PIN para actualizar la lista de proveedores).',
    '',
    `Hoja de pedidos: ${libro_().getUrl()}`
  ].join('\n');
  try {
    // versión con fotos: cada artículo con su foto y la tienda donde pedirlo
    const h = x => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    let mapa = {};
    try { mapa = origenMapa_(); } catch (e) {}
    const filasHtml = p.items.map(i => {
      const o = origenItem_(mapa, i);
      const tienda = o ? `${o.url ? `<a href="${h(o.url)}">${h(o.tienda)}</a>` : h(o.tienda)}${o.ref ? ' · ' + h(o.ref) : ''}${o.contacto ? '<br>Contacto: ' + h(o.contacto) : ''}` : 'tienda sin dato';
      return `<tr><td style="padding:6px 10px 6px 0">${i.foto ? `<img src="${h(i.foto)}" width="90" height="90" style="object-fit:cover;border-radius:8px" alt="">` : ''}</td>` +
        `<td style="padding:6px 0;font:14px Arial,sans-serif"><b>${i.qty} x ${h(i.name)}</b> (${h(i.id)})` +
        `${i.opcion ? `<br><b style="color:#1E66F5">${h(i.opcion)}</b>` : ''}<br>${fmt_(i.price * i.qty)}<br>Pedir en: ${tienda}</td></tr>`;
    }).join('');
    const html = `<div style="font:14px Arial,sans-serif">${h(cuerpo).replace(/\n/g, '<br>')}</div>` +
      `<h3 style="font:bold 15px Arial,sans-serif;margin:18px 0 6px">Artículos pedidos</h3><table style="border-collapse:collapse">${filasHtml}</table>`;
    MailApp.sendEmail({ to: para, subject: asunto, body: cuerpo, htmlBody: html, attachments: [p.archivo.getBlob()] });
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
  const ancho = Math.max(1, sh.getLastColumn());
  const enc = sh.getRange(1, 1, 1, ancho).getValues()[0].map(v => String(v).trim());
  let n = enc.length;
  while (n && !enc[n - 1]) n--;
  const actual = enc.slice(0, n);
  if (actual.join('|') !== COLS.join('|')) {
    // si a la hoja solo le faltan columnas nuevas, se insertan en su lugar sin tocar los pedidos que ya hay
    let j = 0;
    COLS.forEach(c => { if (j < n && actual[j] === c) j++; });
    if (n > 0 && j === n) agregarCols_(sh, actual); else preparar_(sh);
  }
  return sh;
}

function agregarCols_(sh, actual) {
  const enc = actual.slice();
  COLS.forEach((c, i) => {
    if (enc[i] === c) return;
    if (i < enc.length) sh.insertColumnBefore(i + 1);
    else if (sh.getMaxColumns() < i + 1) sh.insertColumnAfter(sh.getMaxColumns());
    enc.splice(i, 0, c);
    sh.getRange(1, i + 1).setValue(c).setFontWeight('bold').setBackground('#1E66F5').setFontColor('#FFFFFF');
    const col = sh.getRange(2, i + 1, Math.max(1, sh.getMaxRows() - 1), 1);
    col.clearDataValidations().setNumberFormat('General').setFontWeight('normal').setFontColor(null);
    formatoCol_(sh, c);
  });
}

function formatoCol_(sh, c) {
  const filas = Math.max(1, sh.getMaxRows() - 1);
  const ancho = { 'Foto artículo': 110, 'Tienda': 300, 'Comprobante leído': 280, 'Proveedor': 300 }[c];
  if (!ancho) return;
  sh.setColumnWidth(C[c] + 1, ancho);
  const r = sh.getRange(2, C[c] + 1, filas, 1).setVerticalAlignment('middle');
  if (c === 'Foto artículo') r.setHorizontalAlignment('center'); else r.setWrap(true);
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
  ['Foto artículo', 'Tienda', 'Comprobante leído', 'Proveedor'].forEach(c => formatoCol_(sh, c));
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

/* Productos con oferta (catálogo Boom): "antes" es el precio normal y "hasta" el último día de la oferta.
 * Pasada esa fecha (hora de Ecuador) vale el precio normal, igual que en la tienda. */
function precioVigente_(p) {
  const antes = Number(p && p.antes);
  if (!(antes > Number(p.price)) || !p.hasta) return p;
  const hoy = Utilities.formatDate(new Date(), 'America/Guayaquil', 'yyyy-MM-dd');
  return hoy > String(p.hasta) ? Object.assign({}, p, { price: antes }) : p;
}

// Dónde pedir un artículo: tienda de Telegram (hoja "Proveedores") o, para los productos de catálogo, el campo "pedir" de products.json.
function origenItem_(mapa, i) {
  const o = mapa && mapa[i.id];
  if (o && o.tienda) return { tienda: o.tienda, ref: `publicación ${o.num}`, url: o.url, contacto: contactos_()[o.canal] || '' };
  const q = i.pedir;
  return q && q.tienda ? { tienda: String(q.tienda), ref: String(q.ref || ''), url: String(q.url || '') } : null;
}

// Teléfonos de pedidos de cada tienda de Telegram (canales.json, "contactos").
function contactos_() {
  if (contactos_.c) return contactos_.c;
  const cache = CacheService.getScriptCache();
  let txt = cache.get('contactos');
  if (!txt) {
    txt = '{}';
    try {
      const r = UrlFetchApp.fetch(BASE_TIENDA_ + 'canales.json', { muteHttpExceptions: true });
      if (r.getResponseCode() === 200) txt = JSON.stringify(JSON.parse(r.getContentText()).contactos || {});
    } catch (e) {}
    cache.put('contactos', txt, 21600);
  }
  contactos_.c = JSON.parse(txt);
  return contactos_.c;
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
    return Object.fromEntries(list.map(p => [p.id, precioVigente_(p)]));
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
