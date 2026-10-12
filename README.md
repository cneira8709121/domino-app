# Dominó

Dominó en 2D para un jugador: tú contra el celular. Es una app web instalable (PWA):
se instala desde el navegador del celular, sin PC, y funciona sin internet.

## Cómo jugar

- Doble seis, 7 fichas por jugador; el resto queda en el **pozo**.
- Tus fichas están abajo. **Arrástralas** hasta el extremo iluminado de la mesa (o tócalas).
- Si no tienes jugada, toca el pozo para robar; si está vacío, pulsa «Pasar».
- Quien se queda sin fichas gana la mano y suma los puntos del rival. En un tranque gana quien tenga menos puntos.
- Gana la partida el primero en llegar a la meta (50, 100, 150 o 200).
- Tres niveles de dificultad para el celular. La partida se guarda sola.

## Instalar en el celular (sin PC)

1. Publica el juego con GitHub Pages: en GitHub, **Settings → Pages → Build and deployment**,
   elige *Deploy from a branch*, la rama con el juego y la carpeta `/ (root)`, y guarda.
2. Al minuto, abre en el celular `https://<tu-usuario>.github.io/domino-app/`.
3. Android (Chrome): menú ⋮ → **Instalar app** / **Agregar a pantalla principal**.
   iPhone (Safari): botón Compartir → **Agregar a pantalla de inicio**.

Queda un ícono como cualquier app y se puede jugar sin conexión.

## Archivos

- `index.html`, `styles.css`, `game.js`: el juego.
- `manifest.webmanifest`, `sw.js`, `icons/`: instalación y modo sin conexión.
