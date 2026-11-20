"""
Baja el texto original de Telegram de productos que ya están en el catálogo, para revisar
si el proveedor ofrece colores o modelos a elegir (ver CRITERIOS.md, sección 3).

Ubica la publicación de cada producto por su `src` (los 12 primeros caracteres del SHA-1 de
"canal/número") y baja el texto con la vista incrustada de Telegram. El resultado se guarda en un
archivo JSON fuera del repositorio (la acción de GitHub lo deja como artefacto de un día).

Uso: python scripts/textos_telegram.py salida.json [P-101 P-102 ...]   (sin IDs = todos)
"""
import hashlib
import json
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

RAIZ = Path(__file__).resolve().parent.parent
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'}
# números de publicación posibles por canal (se amplían solos si falta alguno)
RANGOS = {'Kaydeecuador': (200000, 260000), 'importadorapandita': (140000, 200000), 'tuhogartextiles': (240000, 300000)}


def ubicar(srcs):
    canales = json.loads((RAIZ / 'canales.json').read_text(encoding='utf-8'))['canales']
    hallados = {}
    for c in canales:
        a, b = RANGOS.get(c, (1, 400000))
        for n in range(a, b):
            h = hashlib.sha1(f'{c}/{n}'.encode()).hexdigest()[:12]
            if h in srcs:
                hallados[srcs[h]] = f'{c}/{n}'
    falta = {h: i for h, i in srcs.items() if i not in hallados}
    if falta:
        for c in canales:
            for n in range(1, 400000):
                h = hashlib.sha1(f'{c}/{n}'.encode()).hexdigest()[:12]
                if h in falta:
                    hallados[falta[h]] = f'{c}/{n}'
    return hallados


def texto(clave):
    r = requests.get(f'https://t.me/{clave}?embed=1&mode=tme', headers=UA, timeout=30)
    r.raise_for_status()
    sopa = BeautifulSoup(r.text, 'html.parser')
    el = sopa.select_one('.tgme_widget_message_text')
    if el:
        for br in el.find_all('br'):
            br.replace_with('\n')
    fotos = len(sopa.select('a.tgme_widget_message_photo_wrap'))
    return (el.get_text().strip() if el else ''), fotos


def main():
    salida = sys.argv[1] if len(sys.argv) > 1 else 'textos.json'
    ids = set(sys.argv[2:])
    productos = json.loads((RAIZ / 'products.json').read_text(encoding='utf-8'))['products']
    srcs = {p['src']: p['id'] for p in productos if p.get('src') and (not ids or p['id'] in ids)}
    claves = ubicar(srcs)
    out = {}
    for i, (pid, clave) in enumerate(sorted(claves.items())):
        try:
            t, fotos = texto(clave)
            out[pid] = {'clave': clave, 'texto': t, 'fotos': fotos}
        except Exception as e:  # noqa: BLE001
            out[pid] = {'clave': clave, 'error': str(e)}
        time.sleep(0.4)
        if i % 50 == 0:
            print(i, 'de', len(claves))
    Path(salida).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    print('listo:', len(out), 'productos,', sum(1 for v in out.values() if v.get('texto')), 'con texto')


if __name__ == '__main__':
    main()
