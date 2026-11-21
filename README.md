# Tienda Online

Tienda en línea pensada para celular: catálogo, carrito, reserva con abono del 50% y comprobante de depósito, y seguimiento con código de pedido.

## Archivos

- `index.html`: la tienda completa (diseño, carrito, reserva y seguimiento). Arriba del código está `TIENDA`, con la dirección de Google y los datos bancarios.
- `products.json`: el catálogo. Los domingos, martes y jueves por la noche se agregan productos nuevos "Por aprobar"; las clientas los ven solo cuando el dueño los aprueba. Si el proveedor deja elegir color, modelo o diseño, el producto lleva `opciones` y la tienda muestra botones para elegir (ver `CRITERIOS.md`, sección 3).
- `costos.json`: el precio de Telegram de cada producto, cifrado. Solo lo ve el dueño en la página de revisión.
- `CRITERIOS.md`: las reglas para elegir y preparar productos (temporada, descripciones, colores, fotos, precio).
- `google-apps-script/Codigo.gs`: el programa que va en la hoja de Google "Tienda Online · Pedidos". Recibe los pedidos, guarda los comprobantes en Drive, marca alertas y envía el aviso por correo.

## Hoja de pedidos

Cada pedido trae, junto a "Productos", la columna **Foto artículo** (la foto del producto pedido; si son varios, la del primero) y la columna **Tienda** (en qué tienda de Telegram pedir cada artículo, con enlace a la publicación y a la foto de cada uno). El correo de aviso también muestra la foto y la tienda de cada artículo. Los pedidos anteriores se completan solos la próxima vez que abres `#revisar` con tu PIN.

La lectura automática del comprobante acepta el monto que escribió la clienta, el abono o el total, aunque el lector de la foto separe los decimales ("10 , 00"), no traiga centavos ("$20") o confunda la O con el cero. Si un pedido quedó con una alerta que no corresponde, en `#revisar` → Pedidos → el pedido, toca **Volver a leer el comprobante**.

## Compartir el carrito

Debajo del resumen del carrito, el botón principal es **Enviar o compartir carrito**. En el celular abre las opciones de compartir del propio teléfono (WhatsApp, Telegram, correo, mensajes...); en la computadora abre un menú con WhatsApp, Telegram, Correo y Copiar texto. El mensaje lleva el código, los productos con su color o modelo, total, abono del 50%, saldo, un enlace al pedido con fotos (`#pedido-PED-XXXX`) y dos líneas para que la clienta escriba su nombre y su dirección. La clienta no llena formularios: el abono y la entrega se coordinan por chat. Debajo queda el enlace "O reserva aquí con tu comprobante".

- Al compartir, el carrito se registra en la hoja "Pedidos" (Envío "Carrito compartido", fila verde, sin datos personales) con la foto y la tienda de cada artículo, y llega un correo con el resumen.
- En `#revisar` → Pedidos sale como "Carrito compartido", con cada producto, su foto y dónde pedirlo (tienda de Telegram con publicación y contacto, o "Revista web Boom" con la página). Cuando llegue el abono, se marca Aprobado.
- La clienta ve su pedido en "Mis pedidos" o con el enlace del mensaje, solo con el código. Si quien abre el enlace tiene el PIN guardado (la dueña), sale el botón "Ver detalle para la tienda".
- Los teléfonos de pedidos de cada tienda de Telegram están en `canales.json` → `contactos`.

## Reserva en la página (con comprobante)

Formulario corto en dos pasos: 1) nombre y apellido, celular, ciudad y dirección; 2) depositar el abono y subir la foto del comprobante. No pide cédula, monto ni número de comprobante: el programa de Google los lee de la foto. Las condiciones de reserva quedan plegadas en "Ver condiciones".

## Productos Boom (catálogo por campaña)

Además de lo que llega de Telegram, la tienda vende los productos del catálogo Boom (marcas WIP WIP, TesQui, Ameli, Aku y RunRun) con los precios del catálogo, tal cual. Se ven con el botón verde **Productos Boom**, junto a Categorías y Filtro (y en la barra flotante). La dirección `https://tiendaonline-ec.github.io/#boom` abre directo esa sección, para compartirla.

- En `products.json` llevan `"linea": "boom"`, ids `B-101` en adelante y `"status": "aprobado"`.
- Si el catálogo tiene oferta, `price` es el precio de oferta, `antes` el precio normal (sale tachado) y `hasta` el último día de la oferta. Desde el día siguiente la tienda y el programa de Google cobran solos el precio normal.
- `pedir` dice dónde pedirlo: "Catálogo Boom C12 · página N" y el enlace al folleto del producto. Sale en la página de revisión, en la hoja de pedidos y en el correo.
- Los aromas al mismo precio van en un solo producto con botones (por ejemplo, el desinfectante de 1000 ml); si cambia el tamaño o el precio, son productos aparte.
- Las fotos se recortan de las páginas del PDF (sin textos ni precios) y se mejoran con súper resolución.
- **Cada campaña nueva** (la C12 va del 6 de noviembre al 3 de diciembre de 2026): pasar el PDF nuevo para actualizar precios, ofertas y productos.

## Color o modelo elegido

Cuando un producto tiene botones para elegir, la clienta no puede agregarlo sin elegir, y cada elección es una línea aparte del carrito (el mismo adorno en rojo y en azul son dos líneas). En la hoja, "Productos" dice por ejemplo "1 x Adorno navideño (Color: Rojo)", "Códigos" dice "P-216 x1 [Color: Rojo]" y la foto del artículo es la del color elegido si se sabe cuál es. El correo y la página de revisión también muestran la elección.

Para revisar los productos ya publicados con su texto original de Telegram está la acción "Textos de Telegram del catálogo" (`.github/workflows/textos.yml`): se lanza con una llave pública, deja el resultado cifrado en la rama temporal `textos-tmp`, y lanzándola con "borrar" = si se borra esa rama después de leerla.

## Celular

Para volver arriba se toca la barra "↑ Tienda Online" que aparece arriba al bajar, o otra vez la pestaña Tienda. En la computadora también está "Subir" en la barra de la izquierda. Ya no hay botón flotante abajo a la derecha, porque quedaba encima del botón + de los productos. Las tarjetas fuera de la pantalla no se dibujan hasta acercarse, para que la lista de más de 500 productos se mueva fluida.

## Estados de un pedido

Se cambian en la columna **Estado** de la hoja: Pendiente, Aprobado, En camino, Entregado o Rechazado. La clienta ve el cambio al consultar su pedido en "Mis pedidos" con su código (PED-XXXX), que recibe al hacer el pedido y que también sale en la hoja, en el correo de aviso y en `#revisar`.

- Desde el 21 de noviembre de 2026 basta el código. Los pedidos anteriores con celular piden además los últimos 4 dígitos (la página muestra ese campo solo cuando hace falta).
- Cuando ya se hayan entregado todos los anteriores, para quitar ese paso: en `google-apps-script/Codigo.gs` cambiar `CODIGO_SOLO_DESDE` a `'2000-01-01'` y publicar una versión nueva del programa.
- Cada celular puede hacer 10 búsquedas sin resultado; después debe esperar una hora (desde el 3.er intento que queda le avisa cuántos le quedan). En toda la tienda hay además un tope de 300 por hora contra programas que prueban códigos al azar.

## Carga de productos nuevos (domingos, martes y jueves)

1. La acción de GitHub "Traer productos de Telegram" (se puede lanzar a mano con más "horas" y "páginas" para traer más historial) corre esos días a las 18:07 (Ecuador), con margen porque GitHub suele retrasar las acciones programadas, y deja en la rama `entrada` lo publicado en las últimas 74 horas (`items.json` y `img/`).
2. A las 22:05 una tarea programada de Claude (si la entrada tiene más de 12 horas, primero lanza la acción a mano y espera a que termine):
   - toma de `entrada` los productos que no están en `products.json` (se comparan por `src`, que son los 12 primeros caracteres del SHA-1 de `clave`);
   - elige los que más se pueden vender según `CRITERIOS.md` (máximo 15 por vez) y escribe nombre, categoría, precio con margen, descripción completa, características y, si el proveedor deja elegir color o modelo, las `opciones`;
   - prepara las fotos con `python3 scripts/procesar_fotos.py decisiones.json carpeta_entrada` (borra precios y textos del proveedor y mejora con súper resolución solo las fotos pequeñas o borrosas);
   - guarda el precio de Telegram cifrado con `python3 scripts/costos.py P-201=3.50 ...` y la tienda de origen cifrada con `python3 scripts/origen.py P-201=canal/numero ...`;
   - revisa las fotos a ojo (sin precios, sin otros idiomas, sin marcas de agua) y sube los cambios.
3. Los productos nuevos quedan "Por aprobar" hasta que el dueño los apruebe en `#revisar`.

## Página de revisión (`#revisar`, con PIN)

- **Productos:** aprobar, rechazar o pedir cambios. Cada producto muestra el precio de Telegram, la ganancia y de qué tienda de Telegram sale (con el número de publicación y un botón para abrirla).
- Las decisiones se guardan en Google y la acción "Sincronizar aprobaciones" (`.github/workflows/estados.yml`, cada hora) las copia al campo `status` de `products.json`. Así la tienda muestra los productos apenas abre, sin esperar a Google; al responder Google se aplican los cambios de la última hora.
- **Pedidos:** buscar pedidos y cambiar su estado. Cada producto del pedido dice en qué tienda pedirlo y el número de publicación.
- **Visitas:** personas en línea ahora, visitantes y visitas de hoy, 7 o 30 días, tiempo promedio, productos más vistos, de dónde llegan (WhatsApp, Facebook, directo...), dispositivo y visitas recientes. Se actualiza solo cada minuto. Solo se guardan números anónimos en la hoja "Visitas".

`origen.json` guarda cifrada la tienda y la publicación de cada producto (el repositorio es público). Al abrir la página de revisión con el PIN, la lista se copia a la hoja "Proveedores", y desde ahí cada pedido nuevo anota en la columna "Proveedor" y en el correo dónde pedir cada producto.

### Actualizar el programa de Google (cuando cambia `google-apps-script/Codigo.gs`)

1. Abre el proyecto de Apps Script de la tienda y reemplaza todo el contenido de `Codigo.gs` por el del repositorio.
2. Guarda, luego **Implementar → Administrar implementaciones → editar (lápiz) → Versión: Nueva versión → Implementar**. Así se mantiene la misma dirección que usa la tienda.
3. Abre `https://tiendaonline-ec.github.io/#revisar` con tu PIN para que se llene la hoja "Proveedores".
