#!/bin/bash
# Copia cada complemento (carpeta con manifest.json V3) a un disco nativo
# y hace que cada arranque de Chromium lo cargue.
set -eu

root="${EXTENSIONS_ROOT:-/extensiones}"
stage="/config/complementos-activos"
flags_file="/config/complementos.flags"

if [[ ! -d "$root" ]]; then
  echo "[complementos] No existe ${root}. Chromium arranca sin complementos."
  exit 0
fi

dirs=()
while IFS= read -r manifest; do
  dir="$(dirname "$manifest")"
  case "$dir" in
    *[[:space:],]*)
      echo "[complementos] Ruta no válida (espacio o coma): ${dir}" >&2
      exit 1
      ;;
  esac
  if ! grep -Eq '"manifest_version"[[:space:]]*:[[:space:]]*3' "$manifest"; then
    echo "[complementos] Omitido (no es Manifest V3): ${dir}"
    continue
  fi
  dirs+=("$dir")
done < <(find "$root" -mindepth 2 -maxdepth 2 -type f -name manifest.json | sort)

rm -rf "$stage"
mkdir -p "$stage"

if [[ ${#dirs[@]} -eq 0 ]]; then
  rm -f "$flags_file"
  echo "[complementos] Ningún complemento Manifest V3 en ${root}/*/"
  exit 0
fi

staged=()
for dir in "${dirs[@]}"; do
  name="$(basename "$dir")"
  cp -a "$dir" "$stage/"
  rm -f "${stage}/${name}/.env"
  staged+=("${stage}/${name}")
  echo "[complementos] ${name}"
done
chmod -R a+rX "$stage"

joined="$(IFS=,; echo "${staged[*]}")"
value="--disable-features=DisableLoadExtensionCommandLineSwitch --disable-extensions-except=${joined} --load-extension=${joined}"
printf '%s' "$value" > "$flags_file"

if [[ -f /usr/bin/wrapped-chromium && ! -f /usr/bin/wrapped-chromium.real ]]; then
  mv /usr/bin/wrapped-chromium /usr/bin/wrapped-chromium.real
fi
if [[ -f /usr/bin/wrapped-chromium.real ]]; then
  cat > /usr/bin/wrapped-chromium << 'EOF'
#!/bin/bash
flags=""
if [[ -r /config/complementos.flags ]]; then
  flags="$(cat /config/complementos.flags)"
fi
# shellcheck disable=SC2086
exec /usr/bin/wrapped-chromium.real "$@" $flags
EOF
  chmod 755 /usr/bin/wrapped-chromium
else
  echo "[complementos] No está /usr/bin/wrapped-chromium; no se pudo enganchar el arranque." >&2
  exit 1
fi

env_dir="/run/s6/container_environment"
if [[ -d "$env_dir" ]]; then
  printf '%s' "chrome://extensions" > "${env_dir}/CHROME_CLI"
fi

echo "[complementos] ${#staged[@]} cargado(s): ${joined}"
