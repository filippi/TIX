"""Export the canonical helpers for the browser's copy buttons (no build needed)."""
import json
from pathlib import Path
root = Path(__file__).resolve().parent.parent
sources = {name: (root / name).read_text() for name in ('tix.py', 'tix.h')}
(root / 'docs' / 'sources.js').write_text('window.TIX_SOURCES = ' + json.dumps(sources, ensure_ascii=True) + ';\n')
