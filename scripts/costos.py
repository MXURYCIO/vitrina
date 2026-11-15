#!/usr/bin/env python3
"""Guarda el precio de Telegram (costo del proveedor) de cada producto, cifrado, en costos.json.

Solo la página de revisión puede leerlo: la llave para descifrar vive en Propiedades del
script de Google (COSTOS_LLAVE) y la entrega únicamente con el PIN de dueño. Aquí solo
está la llave pública, que sirve para cifrar y no para leer.

Uso:
  python3 scripts/costos.py P-201=3.50 P-202=7
  python3 scripts/costos.py --json mapa.json      # {"P-201": 3.5, ...}
"""
import base64
import json
import sys
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

RAIZ = Path(__file__).resolve().parent.parent
ARCHIVO = RAIZ / 'costos.json'


def cargar():
    return json.loads(ARCHIVO.read_text(encoding='utf-8'))


def cifrar(publica_pem, valor):
    llave = serialization.load_pem_public_key(publica_pem.encode())
    dato = f'{float(valor):.2f}'.encode()
    sello = llave.encrypt(dato, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    return base64.b64encode(sello).decode()


def main(args):
    if not args:
        print(__doc__)
        return 1
    if args[0] == '--json':
        mapa = json.loads(Path(args[1]).read_text(encoding='utf-8'))
    else:
        mapa = dict(a.split('=', 1) for a in args)
    datos = cargar()
    for pid, valor in mapa.items():
        if not str(pid).startswith('P-') or float(valor) <= 0:
            raise SystemExit(f'Dato no válido: {pid}={valor}')
        datos['costos'][pid] = cifrar(datos['publica'], valor)
    datos['costos'] = dict(sorted(datos['costos'].items()))
    ARCHIVO.write_text(json.dumps(datos, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'{len(mapa)} precio(s) guardado(s). Total en costos.json: {len(datos["costos"])}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
