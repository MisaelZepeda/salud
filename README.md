# ¡Salud!

Juego de cartas para tomar con amigos. App web instalable: gratis, sin anuncios y funciona sin internet.

- 4 niveles: Calentamiento, Fiesta, Sin control y Picante +18 (se pueden mezclar). Unas 95 cartas por nivel.
- 5 tipos de cartas: Retos, Yo nunca, ¿Quién es más probable?, Reglas que duran varias cartas y Minijuegos (Caricachupas, ¡Bum!, mímica, duelos…), algunos con temporizador.
- **Mis cartas**: escribe tus propias cartas desde la app; se guardan en el celular y se mezclan al jugar.

## Archivos

| Archivo | Qué es |
| --- | --- |
| `index.html` | Pantallas del juego |
| `styles.css` | Colores y diseño |
| `app.js` | Lógica del juego |
| `cartas.js` | Todas las cartas. Edítalo para agregar o quitar cartas |
| `sw.js` | Guarda la app para que funcione sin internet |
| `manifest.webmanifest` + `icons/` | Nombre e íconos al instalarla |

## Agregar cartas

Abre `cartas.js` y agrega una línea en el modo y tipo que quieras. Usa `{p}` y `{p2}` para que el juego ponga nombres de jugadores al azar:

```js
"{p}, cántale una canción a {p2} o toma 2.",
```

Otros comodines: `{tema}` pone un tema al azar del nivel (la lista `TEMAS`) y `{letra}` una letra al azar. Para un minijuego con temporizador usa `J("texto", segundos)`.

Después sube `VERSION` en `sw.js` (por ejemplo `salud-v2`) para que los celulares que ya la tienen instalada descarguen las cartas nuevas.

## Probar en tu computadora

```bash
python -m http.server 8417
```

Luego abre http://localhost:8417
