#!/bin/sh
# The changes of one version from CHANGELOG.md: the lines under `## [<version>]` up to the next `## [` heading,
# without blank lines at either end. Fails when the version has no section, so a release always says what changed.
# Usage: scripts/changelog-section.sh 0.1.0 [CHANGELOG.md]
version="$1"
file="${2:-CHANGELOG.md}"
section=$(awk -v v="$version" '
  index($0, "## [" v "]") == 1 { on = 1; next }
  on && /^## \[/ { exit }
  on && !/^\[[^]]+\]: / { print }
' "$file" | sed -e '/./,$!d' | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}')
[ -n "$section" ] || { echo "CHANGELOG.md has no section for $version" >&2; exit 1; }
printf '%s\n' "$section"
