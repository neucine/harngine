#!/bin/sh
set -eu

app_directory=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
workspace_directory=$(CDPATH= cd -- "$app_directory/../.." && pwd)
output_directory="$app_directory/public"
compiler="$workspace_directory/node_modules/.bin/weiv"

mkdir -p "$output_directory"
"$compiler" compile emit js "$app_directory/src/ui/App.weiv" > "$output_directory/App.mjs"
"$compiler" compile emit css "$app_directory/src/ui/App.weiv" > "$output_directory/styles.css"
cp "$app_directory/src/ui/main.mjs" "$output_directory/main.mjs"
