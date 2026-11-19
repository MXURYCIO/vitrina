#!/usr/bin/env python3
"""Guarda, cifrado, de qué tienda de Telegram sale cada producto (canal y número de publicación) en origen.json.

El repositorio es público: aquí nunca va el nombre del proveedor en claro. Se cifra con la misma llave
pública de costos.json; solo la página de revisión lo lee con el PIN de dueño y lo pasa a la hoja
"Proveedores" para anotar en cada pedido dónde pedir cada producto.

Uso:
  python3 scripts/origen.py P-216=Kaydeecuador/223318 P-217=importadorapandita/160358
  python3 scripts/origen.py --json mapa.json      # {"P-216": "Kaydeecuador/223318", ...}
"""
import json
import re
import sys
from pathlib import Path

import base64

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

RAIZ = Path(__file__).resolve().parent.parent
ARCHIVO = RAIZ / 'origen.json'


def cifrar(publica_pem, texto):
    llave = serialization.load_pem_public_key(publica_pem.encode())
    sello = llave.encrypt(texto.encode(), padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    return base64.b64encode(sello).decode()


def main(args):
    if not args:
        print(__doc__)
        return 1
    if args[0] == '--json':
        mapa = json.loads(Path(args[1]).read_text(encoding='utf-8'))
    else:
        mapa = dict(a.split('=', 1) for a in args)
    publica = json.loads((RAIZ / 'costos.json').read_text(encoding='utf-8'))['publica']
    datos = json.loads(ARCHIVO.read_text(encoding='utf-8')) if ARCHIVO.exists() else {
        'nota': 'Tienda de Telegram y número de publicación de cada producto, cifrado. Solo la página de revisión lo lee, con el PIN de dueño. Para agregar: python3 scripts/origen.py P-216=canal/numero',
        'origen': {}}
    n = 0
    for pid, clave in mapa.items():
        m = re.fullmatch(r'([A-Za-z0-9_]{3,40})/(\d{1,9})', clave.strip())
        if not re.fullmatch(r'[A-Z]{1,4}-\d{1,6}', pid) or not m:
            print('Se omite', pid, clave)
            continue
        datos['origen'][pid] = cifrar(publica, f'{m.group(1)}|{m.group(1)}/{m.group(2)}')
        n += 1
    datos['origen'] = dict(sorted(datos['origen'].items(), key=lambda kv: int(kv[0].split('-')[1])))
    ARCHIVO.write_text(json.dumps(datos, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'{n} origen(es) guardado(s). Total en origen.json: {len(datos["origen"])}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
