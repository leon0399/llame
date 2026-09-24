"""Run selected upstream pure functions without loading model/GPU dependencies.

Requires Python 3.10+ and a LensVLM checkout at the revision below. Only the
unchanged normalization, page-call parsing, and text-response function ASTs are
executed; this is not a vision-rendering or model-quality benchmark.
"""

import ast
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import List, Optional, Tuple

REVISION = "10709a7e2a80bdf971628359d47e4bd35fce3d95"

if len(sys.argv) != 2:
    raise SystemExit("Usage: python3 lens-preprocessing.py <LensVLM checkout>")
checkout = Path(sys.argv[1]).resolve()
revision = subprocess.check_output(
    ["git", "-C", str(checkout), "rev-parse", "HEAD"], text=True
).strip()
assert revision == REVISION, "Use the inspected upstream revision."

scope = {"re": re, "os": os, "List": List, "Optional": Optional, "Tuple": Tuple}
source_hashes = {}
for filename, names in {
    "lensvlm/rendering.py": {"normalize_text_for_rendering_with_map"},
    "lensvlm/evaluate.py": {"parse_tool_call", "_build_tool_response"},
}.items():
    source = (checkout / filename).read_text()
    source_hashes[filename] = hashlib.sha256(source.encode()).hexdigest()
    tree = ast.parse(source, filename)
    nodes = [
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name in names
    ]
    assert {node.name for node in nodes} == names
    module = ast.Module(body=nodes, type_ignores=[])
    exec(compile(module, filename, "exec"), scope)

original = "def decision():\n    if ready:\n        return 'accepted'\n\n# source note\n"
normalized, position_map = scope["normalize_text_for_rendering_with_map"](original)
assert "\n" not in normalized
assert "    " not in normalized
assert normalized != original
start = original.index("accepted")
assert normalized[position_map[start] : position_map[start] + 8] == "accepted"

parse = scope["parse_tool_call"]
expected = '<tool_call>{"name":"read_page","arguments":{"page":1}}</tool_call>'
other_name = '<tool_call>{"name":"unrelated_tool","arguments":{"page":1}}</tool_call>'
assert parse(expected) == 1
assert parse(other_name) == 1
sample = {"page_texts": [normalized]}
response = scope["_build_tool_response"](1, sample, False)
assert normalized in response
assert scope["_build_tool_response"](2, sample, False) is None

print(
    json.dumps(
        {
            "revision": revision,
            "source_sha256": source_hashes,
            "mode": "unchanged pure function ASTs; no model, renderer, or network",
            "normalized_text": normalized,
            "original_line_breaks_and_indentation_removed": True,
            "original_character_position_maps_to_normalized_answer": True,
            "page_parser_accepts_unrelated_tool_name": True,
            "page_response_is_bounded_by_supplied_page_list": True,
            "conclusion": "Retain original source coordinates separately; do not reuse the research parser as a general tool dispatcher.",
        },
        indent=2,
    )
)
