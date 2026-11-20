# Criterios para elegir y preparar productos

Reglas que sigue la actualización de los domingos, martes y jueves (y cualquier carga manual) al pasar productos de los canales de Telegram a la tienda. Las decidió el dueño de la tienda.

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

## 3. Colores, modelos y opciones para elegir

Leer **siempre el texto completo** de la publicación y **mirar todas las fotos** para decidir si la clienta puede elegir.

### Con botones para elegir (campo `opciones`)

Cuando el proveedor **ofrece elegir** entre colores, modelos, diseños, figuras, tallas o tamaños, todos al mismo precio. Señales: enumera lo que hay ("disponible en rojo, azul y amarillo", "modelos: caballos y flores", "escoja su color", "colores: ..."), o las fotos muestran cada modelo con su nombre o número.

```json
"opciones": [
  {"nombre": "Color", "valores": ["Rojo", "Azul", "Amarillo"], "fotos": [0, 1, null]},
  {"nombre": "Modelo", "valores": ["Caballos", "Flores"]}
]
```

- Un grupo por cada cosa a elegir. Nombres: Color, Modelo, Diseño, Figura, Talla, Tamaño o Aroma.
- Valores cortos, con mayúscula inicial y como los ofrece el proveedor ("Rosado", "Azul marino", "Caballos"). Mínimo 2 valores. Sin comas, corchetes ni el signo |.
- `fotos` es opcional: la posición en `imgs` de la foto que muestra cada valor (o `null`). Al tocar el color, la tienda muestra esa foto, y la hoja de pedidos y el correo usan esa foto.
- Si el precio cambia según el modelo o el tamaño, no es una opción: cada uno se publica como producto aparte.
- La descripción no dice "según disponibilidad": nombra lo que hay y termina con "elige el color (o el diseño, la talla) al agregarlo al carrito". En las características, por ejemplo "Rosado o azul, a elegir".
- En la tienda la clienta no puede agregar el producto sin elegir, y el pedido llega con la elección (por ejemplo "Color: Rojo · Modelo: Caballos").

### Sin botones

- Si el proveedor dice **surtido, al azar, variados o según disponibilidad** (aunque nombre algunos colores): no se deja elegir. Va en la descripción: "Color surtido, según disponibilidad" o "Disponible en rosado y azul (según disponibilidad)".
- Si no dice nada y las fotos muestran varios colores: "Color según disponibilidad".
- Si hay **un solo color** (por ejemplo "disponible solo en negro"):
  - el color va en el nombre (por ejemplo "Espejo de cuerpo entero con soporte, negro"),
  - la primera característica dice "Disponible solo en color negro" y la descripción también lo dice,
  - se **quitan todas las fotos que muestren otros colores**.
- Ante la duda, sin botones: solo se promete lo que el proveedor asegura.

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

## 6. Categorías y equilibrio

Categorías de la tienda: navidad, hogar, cocina, belleza (cabello, maquillaje, pestañas, uñas), cuidado (masajeadores, cuidado personal), bebes, juguetes, tecno, deporte, herramientas (carro, moto, bicicleta y herramientas), escolar (útiles, oficina, mochilas), moda (gorras, bolsos, canguros, relojes, accesorios), mascotas y otros.

- Buscar variedad: que ninguna categoría crezca mucho más que las demás. Si cocina u hogar ya tienen muchos, dar prioridad a las categorías con menos productos.
- Si aparecen productos de un tipo nuevo que tiene salida (gorras, ropa, repuestos de moto, artículos de anime sin personajes con licencia, etc.), se pueden agregar en la categoría más cercana o en "otros".
- Nunca personajes con licencia (Disney, Marvel, Hello Kitty, Labubu, Snoopy, Grinch), marcas falsas ni medicinas o suplementos.
- Nunca repetir un producto que ya está en el catálogo, aunque venga de otra publicación o de la otra tienda.

## 7. Aprobación

Todo producto nuevo entra como "Por aprobar". Solo se publica cuando el dueño lo aprueba en la página de revisión.

## 7. Productos del catálogo Boom

No siguen las secciones 1 y 5: se publican todos los del catálogo, con el precio del catálogo tal cual (la ganancia ya viene incluida) y aprobados de una vez. Las ofertas llevan el precio normal tachado y su fecha de fin. La marca del envase se deja en el nombre y en la foto. Ver "Productos Boom" en README.md.
