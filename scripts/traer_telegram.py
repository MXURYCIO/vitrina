"""
Trae las publicaciones recientes de los canales públicos de Telegram configurados en canales.json.

Junta las fotos sueltas con el mensaje de texto que trae el precio, descarga hasta 4 fotos por
producto (reducidas a 1100 px) y escribe todo en la carpeta de salida:

  salida/items.json   lista de productos encontrados (texto original, precio, fotos)
  salida/img/*.jpg    fotos

Uso: python scripts/traer_telegram.py [carpeta_salida] [horas]
"""
import io
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone

import requests
from bs4 import BeautifulSoup
from PIL import Image

SALIDA = sys.argv[1] if len(sys.argv) > 1 else 'salida'
HORAS = float(sys.argv[2]) if len(sys.argv) > 2 else 26
MAX_PAGINAS = int(os.environ.get("MAX_PAGINAS") or 25)
MAX_FOTOS = 4
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'}
RE_PRECIO = re.compile(r'(?:precio[^$\d\n]{0,25})?\$\s*(\d{1,4}(?:[.,]\d{1,2})?)', re.I)
RE_FONDO = re.compile(r"background-image:url\('([^']+)'\)")


def canales():
    with open(os.path.join(os.path.dirname(__file__), '..', 'canales.json'), encoding='utf-8') as f:
        cfg = json.load(f)
    return [c for c in cfg.get('canales', []) if c not in set(cfg.get('lista_negra', []))]


def texto(el):
    if not el:
        return ''
    for br in el.find_all('br'):
        br.replace_with('\n')
    return el.get_text().strip()


def precio(txt):
    hallados = [(m.group(0).lower().startswith('precio'), m.group(1)) for m in RE_PRECIO.finditer(txt)]
    if not hallados:
        return None
    hallados.sort(key=lambda x: not x[0])
    try:
        return float(hallados[0][1].replace(',', '.'))
    except ValueError:
        return None


def leer_pagina(canal, antes=None):
    url = f'https://t.me/s/{canal}' + (f'?before={antes}' if antes else '')
    r = requests.get(url, headers=UA, timeout=30)
    r.raise_for_status()
    sopa = BeautifulSoup(r.text, 'html.parser')
    mensajes = []
    for m in sopa.select('div.tgme_widget_message[data-post]'):
        post = m['data-post']
        try:
            num = int(post.split('/')[-1])
        except ValueError:
            continue
        t = m.select_one('time[datetime]')
        fecha = datetime.fromisoformat(t['datetime']) if t else None
        fotos = []
        for a in m.select('a.tgme_widget_message_photo_wrap'):
            u = RE_FONDO.search(a.get('style', ''))
            if u:
                fotos.append(u.group(1))
        es_video = bool(m.select_one('.tgme_widget_message_video_player, .tgme_widget_message_roundvideo'))
        mensajes.append({'canal': canal, 'num': num, 'fecha': fecha, 'texto': texto(m.select_one('.tgme_widget_message_text')),
                         'fotos': fotos, 'video': es_video})
    return mensajes


def recientes(canal, desde):
    vistos, antes = {}, None
    for _ in range(MAX_PAGINAS):
        pagina = leer_pagina(canal, antes)
        if not pagina:
            break
        for m in pagina:
            vistos[m['num']] = m
        menor = min(m['num'] for m in pagina)
        mas_viejo = min((m['fecha'] for m in pagina if m['fecha']), default=None)
        if (mas_viejo and mas_viejo < desde) or menor == antes:
            break
        antes = menor
        time.sleep(1)
    return [vistos[k] for k in sorted(vistos) if vistos[k]['fecha'] and vistos[k]['fecha'] >= desde]


def agrupar(mensajes):
    """Une las fotos sin texto con el siguiente mensaje que trae precio (dentro de 15 minutos)."""
    productos, fotos_sueltas, ultima = [], [], None
    for m in mensajes:
        if ultima and (m['fecha'] - ultima).total_seconds() > 900:
            fotos_sueltas = []
        if m['fotos'] and not m['texto']:
            fotos_sueltas += m['fotos']
            ultima = m['fecha']
            continue
        p = precio(m['texto']) if m['texto'] else None
        if p and (m['fotos'] or fotos_sueltas):
            fotos = (fotos_sueltas + m['fotos'])[:MAX_FOTOS] if m['fotos'] else fotos_sueltas[-MAX_FOTOS:]
            productos.append({'clave': f"{m['canal']}/{m['num']}", 'canal': m['canal'], 'fecha': m['fecha'].isoformat(),
                              'texto': m['texto'], 'precio': p, 'fotos_url': fotos})
        fotos_sueltas, ultima = [], m['fecha']
    return productos


def bajar(url, destino):
    r = requests.get(url, headers=UA, timeout=30)
    r.raise_for_status()
    im = Image.open(io.BytesIO(r.content)).convert('RGB')
    im.thumbnail((1100, 1100))
    im.save(destino, 'JPEG', quality=84, optimize=True)


def main():
    os.makedirs(os.path.join(SALIDA, 'img'), exist_ok=True)
    desde = datetime.now(timezone.utc) - timedelta(hours=HORAS)
    todos = []
    for canal in canales():
        try:
            prods = agrupar(recientes(canal, desde))
        except Exception as e:  # un canal caído no detiene a los demás
            print(f'{canal}: error {e}')
            continue
        for p in prods:
            fotos = []
            for i, u in enumerate(p.pop('fotos_url')):
                nombre = f"{p['canal']}_{p['clave'].split('/')[-1]}_{i}.jpg"
                try:
                    bajar(u, os.path.join(SALIDA, 'img', nombre))
                    fotos.append(f'img/{nombre}')
                except Exception as e:
                    print(f"{p['clave']}: no se pudo bajar una foto ({e})")
            if fotos:
                p['fotos'] = fotos
                todos.append(p)
        print(f'{canal}: {len(prods)} productos')
    with open(os.path.join(SALIDA, 'items.json'), 'w', encoding='utf-8') as f:
        json.dump({'generado': datetime.now(timezone.utc).isoformat(), 'horas': HORAS, 'items': todos}, f, ensure_ascii=False, indent=1)
    print(f'Total: {len(todos)} productos')


if __name__ == '__main__':
    main()
