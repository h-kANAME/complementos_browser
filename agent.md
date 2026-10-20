# Lineamientos para complementos

Este directorio es un contenedor. Cada carpeta hermana, salvo `docker/`, `marca/`, `docs/` y los archivos de la raíz, es un complemento de Chrome distinto. El primero es `muestrario`. El que sigue nace con las mismas reglas de diseño, seguridad y uso.

Antes de crear uno, leé este archivo y copiá la estructura de Muestrario en lo que corresponda. No reinventes el panel, los tokens ni el manejo de secretos.

## Forma

- Manifest V3, `minimum_chrome_version` 120. El `manifest.json` vive en la raíz de la carpeta del complemento.
- El nombre de la carpeta va en minúsculas, sin espacios ni comas. Docker arma `--load-extension` con esa ruta y un espacio o una coma parten el flag.
- La interfaz principal es un panel lateral (`side_panel`), no un popup. El service worker solo abre el panel al hacer clic en el ícono.
- La interfaz y los mensajes van en español. El pie muestra la versión. El `<script type="module">` del panel lleva `?v=` con esa misma versión, para que Chrome no se quede con el script anterior.
- Un atajo de teclado abre el complemento.
- Cada complemento trae su propia copia de KYZ (`kyz/tokens`, `kyz/css`, `kyz/brand`). Chrome no lee archivos fuera de la carpeta del complemento. La copia canónica del repo está en `marca/kyz/` y se copia tal cual, sin editar tokens por complemento.
- Los recolectores que se inyectan en la pestaña son funciones autosuficientes. Chrome serializa `func.toString()` y pierde imports y cierres. Nada de leer `chrome` ni variables de afuera dentro de esa función.
- Permisos mínimos. `storage` para lo que el usuario pidió guardar. `<all_urls>` solo si el panel tiene que leer la pestaña activa sin un gesto nuevo en cada navegación. No agregues `web_accessible_resources` para secretos ni para el `.env`.

## Diseño

Los tokens KYZ son la ley. No se inventan colores, fuentes, radios ni sombras. Todo valor visual sale de `--kyz-*` o de una clase `.kyz-*` (`kyz-btn`, `kyz-check`, `kyz-card`, `kyz-input`, `kyz-help`, `kyz-badge`, `kyz-empty`).

- El tema oscuro es el de base. El claro entra por `prefers-color-scheme` y `data-theme`, como ya está en los tokens.
- El verde `#4E9A06` es la acción principal. El estado de éxito no se pinta con ese verde.
- El isotipo KYZ va en el pie. Ahí los hex de marca del SVG se dejan como están en el archivo de marca.
- El ícono de la barra describe la función del complemento, no un logo genérico.
- En el CSS del panel, `[hidden] { display: none !important; }`. Si no, un `display` propio le gana al `hidden` del navegador y secciones vacías siguen a la vista.
- Tipografía, foco visible y `prefers-reduced-motion` salen de los tokens y de `base.css`. No los redefinas en el complemento.

## Uso

- No se recolecta solo. La captura corre cuando la persona pulsa el botón, y solo con los recolectores marcados.
- Al abrir el panel, queda marcado únicamente el recolector principal. En Muestrario es Markdown. Los demás nacen desmarcados, aunque la sesión anterior los haya activado.
- El botón principal es de bloque (`kyz-btn--primary`). La acción que sigue a un resultado, como normalizar y descargar, aparece debajo de ese botón y solo cuando ya hay una captura.
- El estado de cada casilla se lee del DOM en el momento del clic, no de una variable guardada al cargar el panel.
- Si no hay ningún recolector marcado, el mensaje nombra las opciones. No alcanza con decir que falta marcar uno.
- El resultado se muestra en el panel, agrupado, y se puede descargar. El Markdown de una página va por sección: título y el contenido de esa sección.
- Cada dato que se muestra tiene que poder rastrearse en la página. En los colores, el texto del elemento y el botón Ver.
- El historial vive en `chrome.storage.local`, con un tope. No se guardan capturas de pantalla, valores de formularios, contraseñas ni cookies.
- Los estados vacíos y los errores se escriben en español y dicen qué hacer después.
- El Chrome de uso diario y el Chromium de Docker son distintos. Recargar el complemento en `chrome://extensions` actualiza el primero. `docker compose restart navegador` actualiza el segundo.

## Seguridad

Un archivo dentro del paquete publicado no es un secreto. Cualquiera puede descomprimir el zip.

- El `.env` es solo de desarrollo, en la carpeta del complemento descomprimido. Está en `.gitignore`. No se commitea, no se loguea y no se muestra en el panel.
- La instalación publicada (el manifest trae `update_url`) no lee el `.env`, aunque el archivo esté en la carpeta.
- La clave de cada persona se guarda en `chrome.storage.local`, en un campo `type="password"`. Al guardarla se vacía el input y no se vuelve a pintar. No entra en el JSON exportado ni en el historial de capturas. El complemento no la cifra: queda en el perfil de Chrome. El formulario dice de qué proveedor es. En Muestrario es una clave API de OpenAI, las que empiezan con `sk-`, y solo se envía a `https://api.openai.com/v1`.
- La clave solo se envía a una URL `https`, o a `http://localhost` / `http://127.0.0.1`.
- Los mensajes de error pasan por un redactado que tapa `sk-…` y `Bearer …`.
- Docker, al copiar complementos a `/config`, borra el `.env`. Si el archivo sigue ahí, el arranque falla.
- El zip de publicación se arma con `empaquetar.ps1` del complemento. Ese script excluye el `.env` y aborta si uno iba a quedar adentro. No se comprime la carpeta a mano.
- Los recolectores no leen `input`, `textarea` ni `select`.

## Docker y el README

`docker/` levanta un Chromium y carga cada carpeta hermana que tenga `manifest.json` Manifest V3. Después de cambiar código que tenga que verse ahí, se reinicia el servicio `navegador`.

Cada complemento nuevo suma, en el `README.md` de la raíz, una sección corta con:

1. Qué hace y cuándo usarlo.
2. Los pasos para usarlo en Chrome.
3. Una captura del panel en `docs/capturas/<carpeta>.png`, tomada con el ancho de un panel lateral y el tema oscuro.

La captura muestra el estado por defecto: el recolector principal marcado y el resto desmarcado.
