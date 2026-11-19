#!/usr/bin/env python3
"""Hace una imagen vertical (1080 x 1920, para estados de WhatsApp) por producto, con el precio de la tienda.

Estilo de publicidad (no de captura de la página): fondo con la misma foto desenfocada, la foto grande,
el nombre y el precio en una etiqueta llamativa. Abajo, en pequeño, una referencia "Ref. 216-1":
el número del producto y, después del guion, el número de la tienda de Telegram de donde sale
(el orden de canales.json: 1 = primer canal, 2 = segundo...). Las clientas no saben qué tienda es;
quien vende sí. El nombre de la tienda nunca va en la imagen.

Uso:
  python3 scripts/estados.py carpeta_salida [--origen mapa.json] [P-216 P-300 ...]
  mapa.json: {"P-216": "canal/numero", ...} (el mismo formato de scripts/origen.py)
Las imágenes quedan en carpetas por tienda y categoría; el nombre del archivo lleva el precio.
"""
import json
import sys
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

RAIZ = Path(__file__).resolve().parent.parent
W, H = 1080, 1920
AMARILLO = (255, 214, 10)
TINTA = (20, 20, 24)
BLANCO = (255, 255, 255)
CATS = {'navidad': 'Navidad', 'hogar': 'Hogar', 'cocina': 'Cocina', 'belleza': 'Belleza', 'cuidado': 'Cuidado personal',
        'bebes': 'Bebés', 'juguetes': 'Juguetes', 'tecno': 'Tecnología', 'deporte': 'Deporte', 'herramientas': 'Carro y herramientas',
        'escolar': 'Escolar', 'moda': 'Moda', 'mascotas': 'Mascotas', 'otros': 'Otros'}


def fuente(nombre, tam):
    for f in (Path('/usr/share/fonts/opentype/inter') / nombre, Path('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')):
        if f.exists():
            return ImageFont.truetype(str(f), tam)
    return ImageFont.load_default()


def dinero(n):
    return f'${n:.2f}'.replace('.00', '')


def ajustar(d, texto, nombre, tam, ancho, minimo):
    while tam > minimo and d.textlength(texto, font=fuente(nombre, tam)) > ancho:
        tam -= 2
    return fuente(nombre, tam)


def hacer(p, ref):
    foto = Image.open(RAIZ / p['imgs'][0]).convert('RGB')
    # fondo: la misma foto, llenando todo, muy desenfocada y oscurecida
    fondo = ImageOps.fit(foto, (W // 4, H // 4)).filter(ImageFilter.GaussianBlur(18)).resize((W, H), Image.BICUBIC)
    fondo = ImageEnhance.Brightness(ImageEnhance.Color(fondo).enhance(1.3)).enhance(.55)
    im = fondo
    # degradado oscuro abajo para el texto
    grad = Image.new('L', (1, H), 0)
    for y in range(H):
        grad.putpixel((0, y), int(max(0, (y - H * .5) / (H * .5)) ** 1.4 * 235))
    im.paste((8, 10, 16), (0, 0, W, H), grad.resize((W, H)))
    d = ImageDraw.Draw(im)
    # de abajo hacia arriba: pie, precio, nombre; la foto ocupa el espacio que queda arriba
    precio = dinero(p['price'])
    fp = fuente('InterDisplay-Black.otf', 170)
    pw = int(d.textlength(precio, font=fp))
    eti = Image.new('RGBA', (pw + 120, 250), (0, 0, 0, 0))
    de = ImageDraw.Draw(eti)
    de.rounded_rectangle((0, 0, eti.width - 1, eti.height - 1), 48, fill=AMARILLO + (255,))
    de.text((eti.width / 2, eti.height / 2 + 4), precio, font=fp, fill=TINTA, anchor='mm')
    eti = eti.rotate(5, expand=True, resample=Image.BICUBIC)
    ey = H - 200 - eti.height
    tam, ancho_l = 70, 24
    lineas = textwrap.wrap(p['name'], ancho_l)
    if len(lineas) > 2:
        tam, ancho_l = 58, 30
        lineas = textwrap.wrap(p['name'], ancho_l)[:3]
    fn = fuente('InterDisplay-ExtraBold.otf', tam)
    alto_l = int(tam * 1.2)
    ny = ey - 30 - alto_l * len(lineas)
    # foto principal, entera, con esquinas redondeadas y sombra
    maxw, top = W - 100, 160
    maxh = ny - 60 - top
    k = min(maxw / foto.width, maxh / foto.height)
    f2 = foto.resize((round(foto.width * k), round(foto.height * k)), Image.LANCZOS)
    x0, y0 = (W - f2.width) // 2, top + (maxh - f2.height) // 2
    sombra = Image.new('L', (W, H), 0)
    ImageDraw.Draw(sombra).rounded_rectangle((x0, y0 + 24, x0 + f2.width, y0 + f2.height + 24), 44, fill=170)
    im.paste((0, 0, 0), (0, 0), sombra.filter(ImageFilter.GaussianBlur(36)))
    m = Image.new('L', f2.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, f2.width - 1, f2.height - 1), 44, fill=255)
    im.paste(f2, (x0, y0), m)
    d = ImageDraw.Draw(im)
    # etiqueta superior
    fe = fuente('Inter-ExtraBold.otf', 34)
    t = 'DISPONIBLE'
    tw = d.textlength(t, font=fe)
    d.rounded_rectangle((50, 60, 50 + tw + 52, 60 + 66), 33, fill=BLANCO)
    d.text((50 + 26, 93), t, font=fe, fill=TINTA, anchor='lm')
    # nombre
    y = ny
    for ln in lineas:
        d.text((60, y), ln, font=fn, fill=BLANCO)
        y += alto_l
    im.paste(eti, (52, ey), eti)
    d = ImageDraw.Draw(im)
    # abono y llamada a la acción, al lado del precio
    cx = 52 + eti.width + 36
    ancho = W - cx - 50
    fa = ajustar(d, 'Sepáralo con', 'Inter-SemiBold.otf', 40, ancho, 26)
    d.text((cx, ey + 46), 'Sepáralo con', font=fa, fill=(225, 228, 235))
    fa2 = ajustar(d, dinero(p['price'] / 2), 'InterDisplay-ExtraBold.otf', 76, ancho, 40)
    d.text((cx, ey + 96), dinero(p['price'] / 2), font=fa2, fill=AMARILLO)
    fa3 = ajustar(d, 'y el resto al recibir', 'Inter-SemiBold.otf', 36, ancho, 24)
    d.text((cx, ey + 186), 'y el resto al recibir', font=fa3, fill=(225, 228, 235))
    # pie
    fb = fuente('Inter-Bold.otf', 40)
    d.text((W / 2, H - 120), 'Escríbeme para pedirlo', font=fb, fill=BLANCO, anchor='mm')
    fr = fuente('Inter-Medium.otf', 28)
    d.text((W - 50, H - 46), f'Ref. {ref}', font=fr, fill=(170, 176, 190), anchor='rs')
    return im


def main(args):
    if not args:
        print(__doc__)
        return 1
    salida = Path(args[0])
    resto = args[1:]
    mapa = {}
    if resto[:1] == ['--origen']:
        mapa = json.loads(Path(resto[1]).read_text(encoding='utf-8'))
        resto = resto[2:]
    ids = set(resto)
    canales = json.loads((RAIZ / 'canales.json').read_text(encoding='utf-8')).get('canales', [])
    productos = json.loads((RAIZ / 'products.json').read_text(encoding='utf-8'))['products']
    n = 0
    for p in productos:
        if (ids and p['id'] not in ids) or not p.get('imgs'):
            continue
        canal = mapa.get(p['id'], '').split('/')[0]
        num = canales.index(canal) + 1 if canal in canales else 0
        ref = f'{p["id"][2:]}-{num}' if num else p['id'][2:]
        im = hacer(p, ref)
        carpeta = salida / (f'Tienda {num} ({canal})' if num else 'Sin tienda') / CATS.get(p['cat'], 'Otros')
        carpeta.mkdir(parents=True, exist_ok=True)
        nombre = ''.join(c for c in p['name'] if c.isalnum() or c in ' -').strip()[:50]
        im.save(carpeta / f'{p["id"]} {nombre} {dinero(p["price"])}.jpg', 'JPEG', quality=86, optimize=True, progressive=True)
        n += 1
    print(f'{n} imágenes en {salida}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
