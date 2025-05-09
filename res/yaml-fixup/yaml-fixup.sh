#!/bin/bash
source ~/.bashkitrc

read -a files <<< $(find . -type f -name \*.yml)

for f in "${files[@]}"; do
  perl -p "$SCRIPT_DIR/yaml-fixup.pl" < "$f" > "$f.yaml-fixup"
  if diff "$f.yaml-fixup" "$f" > /dev/null; then
    cinfo "$f"
    rm "$f.yaml-fixup"
  else
    cerr "$f"
    mv "$f.yaml-fixup" "$f"
  fi
done

#fswatch -oa . -i sh | xargs -n1 -I{} ./yaml-fixup.sh
#printf "%s: %s\n" "$(date)", "Done"
