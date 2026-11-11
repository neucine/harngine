#!/bin/sh
set -eu

package_directory=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
workspace_directory=$(CDPATH= cd -- "$package_directory/../.." && pwd)
output_directory="$package_directory/public"
compiler="$workspace_directory/node_modules/.bin/weiv"

mkdir -p "$output_directory"
"$compiler" compile emit js "$package_directory/src/ui/App.weiv" > "$output_directory/App.mjs"
"$compiler" compile emit css "$package_directory/src/ui/App.weiv" > "$output_directory/styles.css"
cp "$package_directory/src/ui/main.mjs" "$output_directory/main.mjs"
