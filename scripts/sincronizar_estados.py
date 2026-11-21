"""Copia en products.json las decisiones del dueño (aprobado, rechazado, editar) guardadas en Google.

Así la tienda muestra los productos aprobados apenas abre, sin esperar la respuesta de Google
(que tarda de 1 a 4 segundos). La página igual consulta a Google al abrir, por si hubo cambios
después de la última copia. Lo corre la acción "Sincronizar aprobaciones" (.github/workflows/estados.yml).
"""
import json
import re
import sys
from pathlib import Path

import requests

RAIZ = Path(__file__).resolve().parent.parent
CATALOGO = RAIZ / 'products.json'
VALIDOS = {'aprobado', 'rechazado', 'editar', 'pendiente'}


def url_api():
    html = (RAIZ / 'index.html').read_text(encoding='utf-8')
    m = re.search(r"api:\s*'(https://script\.google\.com/macros/s/[^']+/exec)'", html)
    if not m:
        sys.exit('No encontré la dirección del programa de Google en index.html')
    return m.group(1)


def main():
    r = requests.get(url_api(), params={'action': 'estados'}, timeout=60)
    r.raise_for_status()
    datos = r.json()
    if not datos.get('ok') or not isinstance(datos.get('estados'), dict):
        sys.exit(f'Respuesta inesperada de Google: {str(datos)[:200]}')
    estados = {k: v for k, v in datos['estados'].items() if v in VALIDOS}

    texto = CATALOGO.read_text(encoding='utf-8')
    catalogo = json.loads(texto)
    cambios = []
    for p in catalogo['products']:
        nuevo = estados.get(p.get('id'))
        if nuevo and p.get('status') != nuevo:
            cambios.append(f"{p['id']}: {p.get('status')} -> {nuevo}")
            p['status'] = nuevo
    if not cambios:
        print('Sin cambios: products.json ya tiene las decisiones de Google.')
        return
    final = '\n' if texto.endswith('\n') else ''
    CATALOGO.write_text(json.dumps(catalogo, ensure_ascii=False, indent=1) + final, encoding='utf-8')
    print(f'{len(cambios)} cambios:')
    print('\n'.join(cambios[:50]))


if __name__ == '__main__':
    main()
