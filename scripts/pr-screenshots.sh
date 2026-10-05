#!/bin/sh
# Screenshots for a pull request, without putting images in main's history: the PNGs go into <pr>/ on the pr-assets
# branch (never merged, one commit per upload on top of the last), and the Markdown to paste into the PR description
# is printed. The repo is private, so the links show for whoever can see the repo. Running it again for the same PR
# replaces that PR's folder: pass all of its screenshots each time. Make the screenshots with the harness, see
# harness/README.md › Screenshots for a pull request.
# Usage: scripts/pr-screenshots.sh <pr-number> <file.png>...
set -eu
[ $# -ge 2 ] || { echo "usage: $0 <pr-number> <file.png>..." >&2; exit 2; }
pr=$1; shift
case $pr in *[!0-9]* | "") echo "not a PR number: $pr" >&2; exit 2 ;; esac
for f in "$@"; do
  [ -f "$f" ] || { echo "no file: $f" >&2; exit 2; }
  case $(basename "$f") in *.png | *.jpg | *.jpeg | *.gif) ;; *) echo "not an image: $f" >&2; exit 2 ;; esac
  case $(basename "$f") in *"	"* | *" "*) echo "no spaces or tabs in a name: $f" >&2; exit 2 ;; esac
done
repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
parent=""
if git fetch -q origin pr-assets 2>/dev/null; then parent=$(git rev-parse FETCH_HEAD); fi

entries=$(mktemp)
trap 'rm -f "$entries"' EXIT
for f in "$@"; do printf '100644 blob %s\t%s\n' "$(git hash-object -w "$f")" "$(basename "$f")" >>"$entries"; done
folder=$(git mktree <"$entries")
# the branch's other PRs as they were, this PR's folder new
: >"$entries"
if [ -n "$parent" ]; then git ls-tree "$parent" | grep -v "	$pr\$" >>"$entries" || true; fi
printf '040000 tree %s\t%s\n' "$folder" "$pr" >>"$entries"
top=$(git mktree <"$entries")
if [ -n "$parent" ]; then
  commit=$(git commit-tree "$top" -p "$parent" -m "Screenshots for PR #$pr (not for main)")
else
  commit=$(git commit-tree "$top" -m "Screenshots for PR #$pr (not for main)")
fi
[ -n "$commit" ] || { echo "no commit made" >&2; exit 1; }
# braces around the variable: in zsh "$commit:refs" would read :r as a modifier and push nothing, deleting the branch
git push -q origin "${commit}:refs/heads/pr-assets"

# the links pin this commit, so a later upload does not change what an older PR shows
for f in "$@"; do
  name=$(basename "$f")
  printf '<img src="https://github.com/%s/blob/%s/%s/%s?raw=true" width="900" alt="%s">\n' "$repo" "$commit" "$pr" "$name" "${name%.*}"
done
