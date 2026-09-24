#!/bin/bash
# Собирает архив для магазина Chrome: dist/zakladka-<версия>.zip.
# В архив идёт только то, что нужно расширению, — без заметок, без
# генератора значков и без материалов витрины (store/).
set -euo pipefail
cd "$(dirname "$0")"

ver=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
out="dist/zakladka-$ver.zip"

FILES=(
  manifest.json
  background.js bridge.js common.js resolve.js theme.js
  popup.html popup.js newtab.html newtab.js
  icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png
  icons/saved16.png icons/saved32.png
)

# Файл, который упомянут в манифесте или коде, но не попал в список, —
# верный способ получить сломанное расширение из магазина. Проверяем.
for f in $(grep -ohE '"[A-Za-z0-9_/.-]+\.(js|html|png)"|'"'"'[A-Za-z0-9_/.-]+\.(js|html|png)'"'" \
             manifest.json ./*.js ./*.html | tr -d "\"'" | sort -u); do
  [[ "$f" == http* ]] && continue
  [ -f "$f" ] || continue
  printf '%s\n' "${FILES[@]}" | grep -qx "$f" || { echo "✗ $f используется, но не входит в архив — допишите в FILES"; exit 1; }
done
for f in "${FILES[@]}"; do [ -f "$f" ] || { echo "✗ нет файла $f"; exit 1; }; done

mkdir -p dist
rm -f "$out"
zip -q -X "$out" "${FILES[@]}"
echo "✓ $out ($(du -h "$out" | cut -f1 | tr -d ' '), версия $ver)"
