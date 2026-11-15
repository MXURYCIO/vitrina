# Criterios para elegir y preparar productos

Reglas que sigue la actualización de cada noche (y cualquier carga manual) al pasar productos de los canales de Telegram a la tienda. Las decidió el dueño de la tienda.

## 1. Prioridades de temporada (noviembre y diciembre de 2026)

Elegir primero, en este orden:

1. **Lluvias (fenómeno de El Niño en Ecuador).** Ponchos e impermeables, paraguas, botas de caucho, cubrezapatos, capas para moto y para mochila, cobertores impermeables, tendederos y secadores de ropa para interiores, deshumedecedores, alfombras absorbentes, organizadores contra la humedad.
2. **Navidad.** Árboles, luces, adornos, nacimientos, manteles y cojines navideños, coronas, figuras con luz y música, artículos para la cena y para regalar.
3. Después, lo de siempre: hogar, cocina, cuidado personal y bebés que tenga más probabilidad de venderse.

## 2. Descripciones bien detalladas, con medidas

- Siempre poner medidas, capacidad, tamaño, peso o voltaje cuando el proveedor las da (en cm, m, litros, watts).
- Árboles de Navidad: altura en cm o metros, número de ramas o puntas, tipo de base y si trae luces o adornos.
- Luces: largo en metros, número de focos, tipo (LED), si es a pila, USB o enchufe, y si tiene modos.
- Ponchos e impermeables: talla o medidas, material y si trae capucha.
- Nunca poner teléfonos, enlaces, nombres ni marcas del proveedor.

## 3. Colores

- Si el proveedor dice que hay **un solo color** (por ejemplo "disponible solo en negro"):
  - el color va en el nombre (por ejemplo "Espejo de cuerpo entero con soporte, negro"),
  - la primera característica dice "Disponible solo en color negro" y la descripción también lo dice,
  - se **quitan todas las fotos que muestren otros colores**.
- Si dice **varios colores**: "Disponible en rosado y azul (según disponibilidad)".
- Si dice **colores al azar o surtidos**: "Color surtido, según disponibilidad".
- Si no dice nada y las fotos muestran varios colores: "Color según disponibilidad".

## 4. Fotos

- Solo fotos reales del producto.
- Sin texto en otros idiomas (inglés, portugués, chino, etc.). Si todas lo tienen, recortar o borrar ese texto.
- Sin afiches del proveedor, logos, precios viejos ni números de contacto.
- Fotos de cajas o empaques con texto en otro idioma: se quitan si hay otras fotos limpias; si no, se recorta o se borra ese texto. El texto impreso en el propio producto (marca, "Merry Christmas" de un adorno) se deja.
- Medidas solo en centímetros o milímetros: se borran las pulgadas (in, inch) y las libras (lb).
- Sin marcas de agua, íconos de capturas de pantalla ni fotos de otra marca distinta a la del producto.
- Los datos útiles que aparecen en las fotos (medidas, piezas incluidas, funciones) también van en la descripción.
- Fotos pequeñas (lado mayor menor a 600 px) o borrosas: se mejoran con súper resolución (Real-ESRGAN x4) antes de publicarlas, hasta 1000 px. Se hace en el mismo paso en que se preparan las fotos del producto nuevo, solo a las que lo necesitan y reduciendo la entrada a 400 px como máximo, para que tome segundos y no un lote largo después.

## 5. Precio

Margen sobre el precio del proveedor, redondeado hacia arriba al dólar:

- menos de $5: +100 %
- de $5 a $9.99: +75 %
- $10 o más: +50 %

El precio de Telegram de cada producto nuevo se guarda cifrado en `costos.json` con `python3 scripts/costos.py P-201=3.50`. Nunca va en `products.json` ni en ningún otro archivo público. Solo la página de revisión lo muestra (precio de Telegram, precio de la tienda y ganancia), después de ingresar el PIN.

## 6. Aprobación

Todo producto nuevo entra como "Por aprobar". Solo se publica cuando el dueño lo aprueba en la página de revisión.
