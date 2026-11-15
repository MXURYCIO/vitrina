"""
Mejora fotos pequeñas o borrosas con súper resolución (Real-ESRGAN x4, en CPU con ncnn).

Se usa dentro de procesar_fotos.py, solo en las fotos que lo necesitan, para que tome segundos:
  - la foto mide menos de 600 px en su lado mayor, o
  - está borrosa (varianza del Laplaciano menor a 120 a 512 px de ancho).
Antes de mejorarla se reduce a 400 px como máximo; el resultado queda de hasta 1600 px.

La primera vez instala ncnn (pip) y descarga el modelo a ~/.cache/realesrgan.
Si algo falla, devuelve la foto sin cambios.

Uso suelto: python scripts/mejorar_foto.py foto1.jpg [foto2.jpg ...]   (las mejora en el mismo archivo)
"""
import io
import os
import subprocess
import sys
import zipfile

import numpy as np
from PIL import Image

CACHE = os.path.expanduser('~/.cache/realesrgan')
MODELO = os.path.join(CACHE, 'realesrgan-x4plus')
ZIP = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-ubuntu.zip'
_net = None


def necesita(pil):
    if max(pil.size) < 600:
        return True
    try:
        import cv2
        a = np.array(pil.convert('L')); h, w = a.shape
        g = cv2.resize(a, (512, max(1, int(512 * h / w))))
        return cv2.Laplacian(g, cv2.CV_64F).var() < 120
    except Exception:
        return False


def _cargar():
    global _net
    if _net is not None:
        return _net
    try:
        import ncnn
    except ImportError:
        subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', '--break-system-packages', 'ncnn'], check=True)
        import ncnn
    if not os.path.exists(MODELO + '.bin'):
        os.makedirs(CACHE, exist_ok=True)
        datos = subprocess.run(['curl', '-sSL', ZIP], check=True, capture_output=True).stdout
        with zipfile.ZipFile(io.BytesIO(datos)) as z:
            for n in z.namelist():
                if n.endswith(('realesrgan-x4plus.param', 'realesrgan-x4plus.bin')):
                    with open(os.path.join(CACHE, os.path.basename(n)), 'wb') as f:
                        f.write(z.read(n))
    net = ncnn.Net(); net.opt.use_vulkan_compute = False; net.opt.num_threads = os.cpu_count() or 2
    net.load_param(MODELO + '.param'); net.load_model(MODELO + '.bin')
    _net = (ncnn, net)
    return _net


def _x4(tile):
    ncnn, net = _cargar()
    h, w = tile.shape[:2]
    m = ncnn.Mat.from_pixels(np.ascontiguousarray(tile), ncnn.Mat.PixelType.PIXEL_RGB, w, h)
    m.substract_mean_normalize([0, 0, 0], [1 / 255.0] * 3)
    ex = net.create_extractor(); ex.input('data', m); _, out = ex.extract('output')
    return np.clip(np.array(out).transpose(1, 2, 0) * 255.0, 0, 255).astype(np.uint8)


def mejorar(pil, T=160, PAD=12):
    """Devuelve la foto mejorada (o la misma si no se pudo)."""
    try:
        src = pil.convert('RGB')
        if max(src.size) > 400:
            src = src.copy(); src.thumbnail((400, 400), Image.LANCZOS)
        a = np.array(src); H, W = a.shape[:2]
        out = np.zeros((H * 4, W * 4, 3), np.uint8)
        for y in range(0, H, T):
            for x in range(0, W, T):
                y0, x0 = max(0, y - PAD), max(0, x - PAD)
                r = _x4(a[y0:min(H, y + T + PAD), x0:min(W, x + T + PAD)])
                ty, tx = (y - y0) * 4, (x - x0) * 4
                hh, ww = min(T, H - y) * 4, min(T, W - x) * 4
                out[y * 4:y * 4 + hh, x * 4:x * 4 + ww] = r[ty:ty + hh, tx:tx + ww]
        return Image.fromarray(out)
    except Exception as e:
        print('  (no se pudo mejorar la foto:', e, ')')
        return pil


if __name__ == '__main__':
    for ruta in sys.argv[1:]:
        im = Image.open(ruta).convert('RGB')
        if not necesita(im):
            print(ruta, 'está bien, no se toca'); continue
        nueva = mejorar(im); nueva.thumbnail((1000, 1000), Image.LANCZOS)
        nueva.save(ruta, 'JPEG', quality=84, optimize=True, progressive=True)
        print(ruta, im.size, '->', nueva.size)
