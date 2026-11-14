"""
Prepara las fotos de los productos elegidos para la tienda.

En cada foto busca texto con OCR y borra:
  - precios del proveedor ($7.99, PRECIO, 7,50 ...)
  - teléfonos, @usuarios, enlaces y nombres del proveedor
Si la foto traía precio, escribe en ese lugar el precio nuevo de la tienda.

Uso: python scripts/procesar_fotos.py decisiones.json carpeta_entrada
  decisiones.json: {"items": [{"id": "VT-101", "price": 14, "fotos": ["img/x.jpg", ...], ...}]}
Escribe las fotos en img/p/ y agrega o actualiza los productos en products.json.
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

RAIZ = os.path.join(os.path.dirname(__file__), '..')
SALIDA = os.path.join(RAIZ, 'img', 'p')
AZUL = (30, 102, 245)
RE_PRECIO = re.compile(r'(\$|precio|\d+[.,]\d{2}\b|^\d{1,3}$)', re.I)
RE_PROVEEDOR = re.compile(r'(\d{3}[\s.-]?\d{3}[\s.-]?\d{3,4}|@|t\.me|https?:|www\.|kayde|pandita|importadora|whats|pedidos|cons[ií]guelo|env[ií]os|mayor|precio vip)', re.I)
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
    cajas_precio = []
    for caja, txt, conf in (resultado or []):
        if conf < 0.5:
            continue
        es_precio = bool(RE_PRECIO.search(txt))
        if es_precio or RE_PROVEEDOR.search(txt):
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
        tam = max(30, min(int(bh * 1.25), int(h * 0.09)))
        f = fuente(tam)
        texto = dinero(precio)
        tw, th = f.getbbox(texto)[2], f.getbbox(texto)[3]
        px, py = int(tam * 0.55), int(tam * 0.32)
        ancho, alto = tw + 2 * px, th + 2 * py
        cx, cy = x + bw / 2, y + bh / 2
        x0 = int(min(max(8, cx - ancho / 2), w - ancho - 8))
        y0 = int(min(max(8, cy - alto / 2), h - alto - 8))
        capa = Image.new('RGBA', pil.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(capa)
        d.rounded_rectangle([x0 + 3, y0 + 5, x0 + ancho + 3, y0 + alto + 5], radius=alto // 2, fill=(0, 0, 0, 60))
        d.rounded_rectangle([x0, y0, x0 + ancho, y0 + alto], radius=alto // 2, fill=AZUL + (255,))
        d.text((x0 + px, y0 + py - f.getbbox(texto)[1] // 2), texto, font=f, fill=(255, 255, 255, 255))
        pil = Image.alpha_composite(pil.convert('RGBA'), capa).convert('RGB')
    return pil, borrado, bool(cajas_precio)


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
        imgs = []
        for i, foto in enumerate(it['fotos'][:4]):
            pil, borrado, con_precio = limpiar(os.path.join(entrada, foto), it['price'])
            grande = pil.copy(); grande.thumbnail((1000, 1000))
            nombre = f"{it['id'].lower()}-{i}.jpg"
            grande.save(os.path.join(SALIDA, nombre), 'JPEG', quality=82, optimize=True, progressive=True)
            imgs.append(f'img/p/{nombre}')
            if i == 0:
                peq = pil.copy(); peq.thumbnail((560, 560))
                peq.save(os.path.join(SALIDA, f"{it['id'].lower()}-s.jpg"), 'JPEG', quality=80, optimize=True, progressive=True)
            print(f"{it['id']} foto {i}: {'texto borrado' if borrado else 'sin texto'}{', precio nuevo' if con_precio else ''}")
        actuales[it['id']] = {
            'id': it['id'], 'name': it['name'], 'cat': it['cat'], 'price': it['price'], 'desc': it['desc'],
            'feats': it.get('feats', []), 'imgs': imgs, 'thumb': f"img/p/{it['id'].lower()}-s.jpg",
            'src': it.get('src', ''), 'added': it.get('added', hoy), 'status': it.get('status', 'pendiente')
        }
    catalogo['products'] = sorted(actuales.values(), key=lambda p: p.get('added', ''), reverse=True)
    catalogo['updated'] = hoy
    with open(ruta_cat, 'w', encoding='utf-8') as f:
        json.dump(catalogo, f, ensure_ascii=False, indent=1)
    print(f"Catálogo: {len(catalogo['products'])} productos")


if __name__ == '__main__':
    main()
