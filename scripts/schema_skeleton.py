#!/usr/bin/env python3
"""Print every unique key path (with leaf types) in a large JSON file.

Streams the file through `jq --stream` so it is never loaded into memory.
Array indices are collapsed to `[]`, e.g. `in_network[].negotiated_rates[].negotiated_prices[].negotiated_rate`.

Usage: schema_skeleton.py PATH
"""
import subprocess
import sys
from collections import defaultdict

# Emit "<path>\t<leaf type>" per leaf event, with array indices replaced by "[]".
JQ_FILTER = r"""
inputs
| select(length == 2)
| ((.[0] | map(if type == "number" then "[]" else . end) | join(".")) + "\t" + (.[1] | type))
"""


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    path = sys.argv[1]

    proc = subprocess.Popen(
        ["jq", "-rn", "--stream", JQ_FILTER, path],
        stdout=subprocess.PIPE,
        text=True,
    )
    paths: dict[str, set[str]] = defaultdict(set)
    for line in proc.stdout:
        key, _, leaf_type = line.rstrip("\n").partition("\t")
        paths[key].add(leaf_type)
    if proc.wait() != 0:
        return proc.returncode

    # Collapse "[]" joins: "a.[]" -> "a[]", "a.[].b" -> "a[].b"
    for key in sorted(paths):
        print(f"{key.replace('.[]', '[]')}: {', '.join(sorted(paths[key]))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
