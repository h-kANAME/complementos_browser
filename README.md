# Complementos Chrome

Cada carpeta de este directorio, salvo `docker/`, puede ser un complemento.
El que está ahora es **Muestrario**: un panel que captura la pestaña activa y guarda la paleta que le pedís (colores del CSS, con hex y conteo, y colores visibles del área en pantalla).

Docker levanta un Chromium y carga todos los complementos cuyo `manifest.json` sea Manifest V3 y esté en la raíz de su carpeta.

## Muestrario en tu Chrome

1. Abrí `chrome://extensions`.
2. Activá el modo de desarrollador.
3. Elegí «Cargar descomprimida» y señalá la carpeta `muestrario`.
4. Abrí el ícono de Muestrario (o `Alt+Shift+M`), marcá los recolectores y usá «Capturar esta pantalla».

La captura no corre sola al navegar. No lee valores de formularios ni envía datos fuera del navegador. El historial y el JSON exportado quedan en el perfil de Chrome.

## Todos juntos en Docker

La primera vez descarga cerca de 1 GB.

```bash
docker compose up -d --build
```

Abrí `https://127.0.0.1:3911`, aceptá el certificado local y entrá al escritorio. Chromium abre `chrome://extensions` con los complementos ya cargados. El puerto queda publicado solo en `127.0.0.1`. Si el escritorio no abre por HTTPS, probá `http://127.0.0.1:3910`.

Después de cambiar un complemento:

```bash
docker compose restart navegador
```

## Sumar otro complemento

Creá una carpeta hermana con su `manifest.json` en la raíz (Manifest V3). Al reiniciar el navegador del compose se copia y se carga junto con los demás. El nombre de la carpeta no puede llevar espacios ni comas.

Ejemplo: `otro-complemento/manifest.json`.

## Marca

Los complementos de esta carpeta usan KYZ. Los tokens están en `marca/kyz/` y cada complemento los copia dentro de sí (`kyz/tokens`, `kyz/css`) porque Chrome solo lee archivos de su propia carpeta. No se inventan colores, radios ni sombras: salen de `--kyz-*`.

El ícono de Muestrario es un muestreador: una pantalla con tres tomas (verde, cielo y claro) y un cuentagotas. El isotipo KYZ queda en el pie del panel.

## Modelo

La normalización usa la clave de `muestrario/.env` (`LLM_API_KEY`, `LLM_PROVIDER`, `LLM_BASE_URL`). El panel muestra una vista previa y descarga `.md` o `.json`. Después de editar el archivo, recargá el complemento. Ese `.env` no se copia al navegador de Docker.
