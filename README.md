# Tienda Online

Tienda en línea pensada para celular: catálogo, carrito, reserva con abono del 50% y comprobante de depósito, y seguimiento con código de pedido.

## Archivos

- `index.html`: la tienda completa (diseño, carrito, reserva y seguimiento). Arriba del código está `TIENDA`, con la dirección de Google, el número de WhatsApp y los datos bancarios.
- `products.json`: el catálogo. Los domingos, martes y jueves por la noche se agregan productos nuevos "Por aprobar"; las clientas los ven solo cuando el dueño los aprueba.
- `costos.json`: el precio de Telegram de cada producto, cifrado. Solo lo ve el dueño en la página de revisión.
- `CRITERIOS.md`: las reglas para elegir y preparar productos (temporada, descripciones, colores, fotos, precio).
- `google-apps-script/Codigo.gs`: el programa que va en la hoja de Google "Tienda Online · Pedidos". Recibe los pedidos, guarda los comprobantes en Drive, marca alertas y envía el aviso por correo.

## Estados de un pedido

Se cambian en la columna **Estado** de la hoja: Pendiente, Aprobado, En camino, Entregado o Rechazado. La clienta ve el cambio al consultar su pedido con el código y los últimos 4 dígitos de su celular.

## Carga de productos nuevos (domingos, martes y jueves)

1. La acción de GitHub "Traer productos de Telegram" corre esos días a las 21:30 (Ecuador) y deja en la rama `entrada` lo publicado en las últimas 74 horas (`items.json` y `img/`).
2. A las 22:05 una tarea programada de Claude:
   - toma de `entrada` los productos que no están en `products.json` (se comparan por `src`, que son los 12 primeros caracteres del SHA-1 de `clave`);
   - elige los que más se pueden vender según `CRITERIOS.md` (máximo 15 por vez) y escribe nombre, categoría, precio con margen, descripción completa y características;
   - prepara las fotos con `python3 scripts/procesar_fotos.py decisiones.json carpeta_entrada` (borra precios y textos del proveedor y mejora con súper resolución solo las fotos pequeñas o borrosas);
   - guarda el precio de Telegram cifrado con `python3 scripts/costos.py P-201=3.50 ...`;
   - revisa las fotos a ojo (sin precios, sin otros idiomas, sin marcas de agua) y sube los cambios.
3. Los productos nuevos quedan "Por aprobar" hasta que el dueño los apruebe en `#revisar`.
