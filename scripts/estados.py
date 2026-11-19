#!/usr/bin/env python3
"""Hace una imagen vertical (1080 x 1920, para estados de WhatsApp) por producto, con el precio de la tienda.

Uso:
  python3 scripts/estados.py carpeta_salida                 # todos los productos
  python3 scripts/estados.py carpeta_salida P-216 P-300     # solo esos
Crea una subcarpeta por categoría. Usa la primera foto del producto.
"""
import json
import sys
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

RAIZ = Path(__file__).resolve().parent.parent
W, H = 1080, 1920
AZUL = (30, 102, 245)
TINTA = (17, 24, 39)
GRIS = (90, 99, 115)
FUENTES = [Path('/usr/share/fonts/opentype/inter'), Path('/usr/share/fonts/truetype/dejavu')]
CATS = {'navidad': 'Navidad', 'hogar': 'Hogar y organización', 'cocina': 'Cocina', 'belleza': 'Belleza y cabello',
        'cuidado': 'Cuidado personal', 'bebes': 'Bebés y salud', 'juguetes': 'Juguetes', 'tecno': 'Tecnología',
        'deporte': 'Deporte y ejercicio', 'herramientas': 'Carro, moto y herramientas', 'escolar': 'Escolar y oficina',
        'moda': 'Moda y accesorios', 'mascotas': 'Mascotas', 'otros': 'Otros'}


def fuente(nombre, tam):
    for base in FUENTES:
        for n in (nombre, 'DejaVuSans-Bold.ttf'):
            f = base / n
            if f.exists():
                return ImageFont.truetype(str(f), tam)
    return ImageFont.load_default()


def dinero(n):
    return f'${n:.2f}'.replace('.00', '')


def fondo():
    im = Image.new('RGB', (W, H), (238, 243, 251))
    capa = Image.new('RGB', (W, H), (238, 243, 251))
    d = ImageDraw.Draw(capa)
    d.ellipse((-300, -300, 700, 600), fill=(196, 216, 252))
    d.ellipse((560, 1300, 1500, 2200), fill=(205, 232, 246))
    return Image.blend(im, capa.filter(ImageFilter.GaussianBlur(160)), 1)


def redondo(im, r):
    m = Image.new('L', im.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, im.size[0] - 1, im.size[1] - 1), r, fill=255)
    return m


def pill(d, xy, texto, f, fondo_c, color):
    x, y = xy
    w = d.textlength(texto, font=f)
    a = f.size + 26
    d.rounded_rectangle((x, y, x + w + 44, y + a), a // 2, fill=fondo_c)
    d.text((x + 22, y + a / 2), texto, font=f, fill=color, anchor='lm')
    return x + w + 44


def hacer(p, salida):
    im = fondo()
    d = ImageDraw.Draw(im)
    # encabezado
    x = pill(d, (60, 70), 'Tienda Online', fuente('Inter-Bold.otf', 38), (255, 255, 255), TINTA)
    pill(d, (x + 16, 70), CATS.get(p['cat'], 'Otros'), fuente('Inter-SemiBold.otf', 34), (220, 231, 253), AZUL)
    # foto
    card = (60, 190, W - 60, 190 + 960)
    sombra = Image.new('L', (W, H), 0)
    ImageDraw.Draw(sombra).rounded_rectangle((card[0] + 10, card[1] + 30, card[2] - 10, card[3] + 30), 56, fill=90)
    im.paste((150, 165, 195), (0, 0), sombra.filter(ImageFilter.GaussianBlur(30)))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle(card, 56, fill=(255, 255, 255))
    foto = Image.open(RAIZ / p['imgs'][0]).convert('RGB')
    cw, ch = card[2] - card[0], card[3] - card[1]
    k = max(cw / foto.width, ch / foto.height)
    # si la foto es casi cuadrada se recorta para llenar; si no, se muestra entera
    if abs(foto.width / foto.height - cw / ch) > .18:
        k = min(cw / foto.width, ch / foto.height)
    foto = foto.resize((round(foto.width * k), round(foto.height * k)), Image.LANCZOS)
    lienzo = Image.new('RGB', (cw, ch), (255, 255, 255))
    lienzo.paste(foto, ((cw - foto.width) // 2, (ch - foto.height) // 2))
    im.paste(lienzo, card[:2], redondo(lienzo, 56))
    d = ImageDraw.Draw(im)
    # precio sobre la foto
    fp = fuente('InterDisplay-Black.otf', 150)
    precio = dinero(p['price'])
    pw = d.textlength(precio, font=fp)
    px1, py1 = card[2] - 30, card[3] - 30
    d.rounded_rectangle((px1 - pw - 80, py1 - 200, px1, py1), 60, fill=AZUL)
    d.text((px1 - 40, py1 - 100), precio, font=fp, fill=(255, 255, 255), anchor='rm')
    # nombre
    y = card[3] + 60
    fn = fuente('InterDisplay-Bold.otf', 66)
    lineas = textwrap.wrap(p['name'], 26)[:3]
    for ln in lineas:
        d.text((70, y), ln, font=fn, fill=TINTA)
        y += 80
    y += 16
    # características
    fc = fuente('Inter-Medium.otf', 38)
    for f in (p.get('feats') or [])[:3 if len(lineas) < 3 else 2]:
        t = textwrap.shorten(f, 44, placeholder='…')
        d.ellipse((74, y + 14, 90, y + 30), fill=AZUL)
        d.text((110, y), t, font=fc, fill=GRIS)
        y += 56
    # pie
    pie = H - 250
    d.rounded_rectangle((60, pie, W - 60, H - 70), 44, fill=(255, 255, 255))
    t1 = f'Resérvalo con {dinero(p["price"] / 2)} y paga el resto al recibir'
    tam = 40
    while tam > 28 and d.textlength(t1, font=fuente('Inter-Bold.otf', tam)) > W - 200:
        tam -= 2
    d.text((100, pie + 34), t1, font=fuente('Inter-Bold.otf', tam), fill=TINTA)
    d.text((100, pie + 100), f'Responde este estado para pedirlo · Código {p["id"]}', font=fuente('Inter-Medium.otf', 32), fill=GRIS)
    carpeta = salida / CATS.get(p['cat'], 'Otros').replace(',', '')
    carpeta.mkdir(parents=True, exist_ok=True)
    nombre = ''.join(c for c in p['name'] if c.isalnum() or c in ' -').strip()[:50]
    im.save(carpeta / f'{p["id"]} {nombre} {dinero(p["price"])}.jpg', 'JPEG', quality=86, optimize=True, progressive=True)


def main(args):
    if not args:
        print(__doc__)
        return 1
    salida = Path(args[0])
    ids = set(args[1:])
    productos = json.loads((RAIZ / 'products.json').read_text(encoding='utf-8'))['products']
    n = 0
    for p in productos:
        if (ids and p['id'] not in ids) or not p.get('imgs'):
            continue
        hacer(p, salida)
        n += 1
    print(f'{n} imágenes en {salida}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
