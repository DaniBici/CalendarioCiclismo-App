#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
android_dir="$(cd "$script_dir/.." && pwd)"
catalog="$android_dir/gradle/libs.versions.toml"

maplibre_version="$({
  awk -F '"' '/^[[:space:]]*maplibre[[:space:]]*=/ { print $2; exit }' "$catalog"
})"

if [[ -z "$maplibre_version" ]]; then
  echo "No se pudo obtener la versión de MapLibre de $catalog" >&2
  exit 1
fi

output="${1:-$android_dir/app/build/outputs/native-debug-symbols/release/native-debug-symbols.zip}"
output_dir="$(dirname "$output")"
mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd)"
output="$output_dir/$(basename "$output")"

asset="debug-symbols-maplibre-android-opengl-android-v${maplibre_version}.tar.gz"
url="https://github.com/maplibre/maplibre-native/releases/download/android-v${maplibre_version}/${asset}"
temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/calendario-maplibre-symbols.XXXXXX")"
trap 'rm -rf "$temp_dir"' EXIT

curl --fail --location --retry 3 --silent --show-error \
  "$url" \
  --output "$temp_dir/$asset"

mkdir -p "$temp_dir/symbols"
tar -xzf "$temp_dir/$asset" -C "$temp_dir/symbols"

abis=(armeabi-v7a arm64-v8a x86 x86_64)
for abi in "${abis[@]}"; do
  library="$temp_dir/symbols/$abi/libmaplibre.so"
  if [[ ! -s "$library" ]]; then
    echo "El paquete oficial no contiene $abi/libmaplibre.so" >&2
    exit 1
  fi
done

rm -f "$output"
(
  cd "$temp_dir/symbols"
  zip -9 -q -r "$output" "${abis[@]}"
)

echo "$output"
