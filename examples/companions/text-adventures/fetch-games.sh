#!/bin/sh
# Downloads a few freely distributable Z-code games from the IF Archive into games/.
# Check each game's own licence before you host it for other people.
set -e
cd "$(dirname "$0")"
mkdir -p games
base=https://www.ifarchive.org/if-archive/games/zcode
for f in Advent.z5 LostPig.z8 905.z5 shade.z5; do
  if [ -f "games/$f" ]; then echo "have $f"; continue; fi
  echo "get  $f"
  curl -fsSL -o "games/$f.part" "$base/$f" && mv "games/$f.part" "games/$f"
done
