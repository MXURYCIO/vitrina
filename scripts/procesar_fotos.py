"""
Prepara las fotos de los productos elegidos para la tienda.

En cada foto busca texto con OCR y borra:
  - precios del proveedor ($7.99, PRECIO, 7,50 ...)
  - teléfonos, @usuarios, enlaces y nombres del proveedor
Si la foto traía precio, escribe en ese lugar el precio nuevo de la tienda.

Uso: python scripts/procesar_fotos.py decisiones.json carpeta_entrada
  decisiones.json: {"items": [{"id": "VT-101", "price": 14, "fotos": ["img/x.jpg", ...], ...}]}
Escribe las fotos en img/p/ y agrega o actualiza los productos en products.json.
Si un item trae "opciones" (colores o modelos para elegir), se copian y sus "fotos" se ajustan a las fotos que quedan.
"""
import json
import os
import re
import sys
from datetime import datetime, timezone

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from rapidocr_onnxruntime import RapidOCR

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mejorar_foto import mejorar, necesita  # noqa: E402

RAIZ = os.path.join(os.path.dirname(__file__), '..')
SALIDA = os.path.join(RAIZ, 'img', 'p')
AZUL = (30, 102, 245)
RE_PRECIO = re.compile(r'(\$\s*\d|precio|\b\d{1,3}[.,]\d{2}\b)', re.I)
RE_PROVEEDOR = re.compile(r'(\d{3}[\s.-]?\d{3}[\s.-]?\d{3,4}|@|t\.me|https?:|www\.|kayde|pandita|importadora|whats|pedidos|cons[ií]guelo|env[ií]os|mayor|precio vip)', re.I)
RE_MARCA = re.compile(r'(kayde|pandita|importadora|s[ií]guenos)', re.I)
# texto en portugués o inglés (las fotos de catálogo chino suelen traerlo)
RE_EXTRANJERO = re.compile(r'(ção|ções|ões|ã|õ|acao|icao|ucao|coes|voce|\bnao\b|com ?cabo|\bcom\b|\bpara o\b|pilhas|limpar|limpeza|haste|with|design|sturdy|storage|rotat|wheel|shop|details|product|pulley|hang|toddler|potty|training|reliable|practical|soup ?pot|\bnew\b|\bsize\b|power|\beasy\b|\bfree\b|\bthe\b|\bpink\b|\bblue\b|\bblack\b|\bwhite\b|\bgr[ae]y\b|\bgreen\b|\bpurple\b|\byellow\b|hair|clipper|shaver|trimmer|[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af])', re.I)
FUENTES = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf']

ocr = RapidOCR()


def fuente(tam):
    for f in FUENTES:
        if os.path.exists(f):
            return ImageFont.truetype(f, tam)
    return ImageFont.load_default()


def dinero(n):
    return f'${int(n)}' if float(n).is_integer() else f'${n:.2f}'


def limpiar(ruta, precio):
    img = cv2.imread(ruta)
    h, w = img.shape[:2]
    resultado, _ = ocr(img)
    mascara = np.zeros((h, w), np.uint8)
    cajas_precio, marca, extranjero = [], False, False
    for caja, txt, conf in (resultado or []):
        if float(conf) < 0.5:
            continue
        marca = marca or bool(RE_MARCA.search(txt))
        es_ext = bool(RE_EXTRANJERO.search(txt))
        extranjero = extranjero or es_ext
        es_precio = bool(RE_PRECIO.search(txt))
        if es_precio or es_ext or RE_PROVEEDOR.search(txt):
            pts = np.array(caja, np.int32)
            cv2.fillPoly(mascara, [pts], 255)
            if es_precio:
                cajas_precio.append(cv2.boundingRect(pts))
    borrado = mascara.any()
    if borrado:
        mascara = cv2.dilate(mascara, np.ones((9, 9), np.uint8), iterations=2)
        img = cv2.inpaint(img, mascara, 9, cv2.INPAINT_TELEA)
    pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    if cajas_precio:
        # junta las cajas de precio cercanas y pone la etiqueta nueva en la más grande
        x, y, bw, bh = max(cajas_precio, key=lambda b: b[2] * b[3])
        # une las cajas de precio vecinas (p. ej. "Precio:" arriba de "$6.99") para taparlas todas
        cerca = [b for b in cajas_precio if abs((b[1] + b[3] / 2) - (y + bh / 2)) < bh * 2.2 and abs((b[0] + b[2] / 2) - (x + bw / 2)) < max(bw, b[2]) * 1.5]
        ux0, uy0 = min(b[0] for b in cerca), min(b[1] for b in cerca)
        ux1, uy1 = max(b[0] + b[2] for b in cerca), max(b[1] + b[3] for b in cerca)
        tam = max(30, min(int(bh * 1.25), int(h * 0.09)))
        f = fuente(tam)
        texto = dinero(precio)
        tw, th = f.getbbox(texto)[2], f.getbbox(texto)[3]
        px, py = int(tam * 0.55), int(tam * 0.32)
        ancho = max(tw + 2 * px, ux1 - ux0 + 24)
        alto = max(th + 2 * py, uy1 - uy0 + 16)
        px, py = (ancho - tw) // 2, (alto - th) // 2
        cx, cy = (ux0 + ux1) / 2, (uy0 + uy1) / 2
        x0 = int(min(max(8, cx - ancho / 2), w - ancho - 8))
        y0 = int(min(max(8, cy - alto / 2), h - alto - 8))
        capa = Image.new('RGBA', pil.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(capa)
        d.rounded_rectangle([x0 + 3, y0 + 5, x0 + ancho + 3, y0 + alto + 5], radius=alto // 2, fill=(0, 0, 0, 60))
        d.rounded_rectangle([x0, y0, x0 + ancho, y0 + alto], radius=alto // 2, fill=AZUL + (255,))
        d.text((x0 + px, y0 + py - f.getbbox(texto)[1] // 2), texto, font=f, fill=(255, 255, 255, 255))
        pil = Image.alpha_composite(pil.convert('RGBA'), capa).convert('RGB')
    # nota: 0 = foto limpia, 1 = tenía texto en otro idioma (ya borrado), 2 = afiche del proveedor
    nota = 2 if (marca or cajas_precio) else 1 if extranjero else 0
    return pil, borrado, bool(cajas_precio), nota


def opciones_ok(opciones, nueva):
    """Opciones para elegir (CRITERIOS.md, sección 3). "fotos" se da con la posición en la lista "fotos" de decisiones.json
    y aquí se pasa a la posición final en imgs."""
    salida = []
    for g in opciones or []:
        valores = [' '.join(str(v).replace(',', ' ').replace('[', '').replace(']', '').replace('|', ' ').split()) for v in g.get('valores', [])]
        valores = [v for v in valores if v]
        if not g.get('nombre') or len(valores) < 2:
            continue
        grupo = {'nombre': str(g['nombre']).strip(), 'valores': valores}
        if isinstance(g.get('fotos'), list) and len(g['fotos']) == len(valores):
            fotos = [nueva[i] if isinstance(i, int) and 0 <= i < len(nueva) else None for i in g['fotos']]
            if any(f is not None for f in fotos):
                grupo['fotos'] = fotos
        salida.append(grupo)
    return salida


def main():
    decisiones, entrada = sys.argv[1], sys.argv[2]
    with open(decisiones, encoding='utf-8') as f:
        items = json.load(f)['items']
    os.makedirs(SALIDA, exist_ok=True)
    ruta_cat = os.path.join(RAIZ, 'products.json')
    with open(ruta_cat, encoding='utf-8') as f:
        catalogo = json.load(f)
    actuales = {p['id']: p for p in catalogo.get('products', []) if p.get('imgs')}  # se quitan los de ilustración
    hoy = datetime.now(timezone.utc).isoformat()
    for it in items:
        fotos = []
        for i, foto in enumerate(it['fotos'][:4]):
            pil, borrado, con_precio, nota = limpiar(os.path.join(entrada, foto), it['price'])
            fotos.append((pil, nota))
            if borrado:
                print(f"{it['id']} foto {i}: texto borrado{', precio nuevo' if con_precio else ''}{' (afiche del proveedor)' if nota == 2 else ' (otro idioma)' if nota == 1 else ''}")
        mejor = min(n for _, n in fotos)
        limpias = [p for p, n in fotos if n == mejor]  # solo las fotos más limpias disponibles
        # posición nueva de cada foto de la entrada (None si se descartó), para las fotos de cada opción
        nueva, k = [], 0
        for _, n in fotos:
            nueva.append(k if n == mejor else None)
            k += n == mejor
        imgs = []
        for i, pil in enumerate(limpias):
            if necesita(pil):  # foto pequeña o borrosa: súper resolución en el mismo paso
                pil = mejorar(pil); print(f"{it['id']} foto {i}: mejorada con súper resolución")
            grande = pil.copy(); grande.thumbnail((1000, 1000))
            nombre = f"{it['id'].lower()}-{i}.jpg"
            grande.save(os.path.join(SALIDA, nombre), 'JPEG', quality=82, optimize=True, progressive=True)
            imgs.append(f'img/p/{nombre}')
            if i == 0:
                peq = pil.copy(); peq.thumbnail((560, 560))
                peq.save(os.path.join(SALIDA, f"{it['id'].lower()}-s.jpg"), 'JPEG', quality=80, optimize=True, progressive=True)
        actuales[it['id']] = {
            'id': it['id'], 'name': it['name'], 'cat': it['cat'], 'price': it['price'], 'desc': it['desc'],
            'feats': it.get('feats', []), 'imgs': imgs, 'thumb': f"img/p/{it['id'].lower()}-s.jpg",
            'src': it.get('src', ''), 'added': it.get('added', hoy), 'status': it.get('status', 'pendiente')
        }
        opciones = opciones_ok(it.get('opciones'), nueva)
        if opciones:
            actuales[it['id']]['opciones'] = opciones
    catalogo['products'] = sorted(actuales.values(), key=lambda p: p.get('added', ''), reverse=True)
    catalogo['updated'] = hoy
    with open(ruta_cat, 'w', encoding='utf-8') as f:
        json.dump(catalogo, f, ensure_ascii=False, indent=1)
    print(f"Catálogo: {len(catalogo['products'])} productos")


if __name__ == '__main__':
    main()
