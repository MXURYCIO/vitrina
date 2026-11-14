# Vitrina

Tienda en línea pensada para celular: catálogo, carrito, reserva con abono del 50% y comprobante de depósito, y seguimiento con código de pedido.

## Archivos

- `index.html`: la tienda completa (diseño, carrito, reserva y seguimiento). Arriba del código está `TIENDA`, con la dirección de Google, el número de WhatsApp y los datos bancarios.
- `products.json`: el catálogo. Cada noche se actualiza con los productos nuevos aprobados.
- `google-apps-script/Codigo.gs`: el programa que va en la hoja de Google "Vitrina · Pedidos". Recibe los pedidos, guarda los comprobantes en Drive, marca alertas y envía el aviso por correo.

## Estados de un pedido

Se cambian en la columna **Estado** de la hoja: Pendiente, Aprobado, En camino, Entregado o Rechazado. La clienta ve el cambio al consultar su pedido con el código y los últimos 4 dígitos de su celular.
