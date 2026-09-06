from pathlib import Path
from engine.self_description import admit_self_context, load_self_description

ROOT = Path(__file__).resolve().parents[2]
snapshot = load_self_description(ROOT)
assert snapshot['sections'], 'self-description sections missing'
assert any(item['id'] == 'project' for item in snapshot['sections'])
result = admit_self_context(ROOT, query='刷新恢复 stream', budget=1200)
assert result['used'] <= 1200
assert result['text']
assert 'Bearer' in admit_self_context(ROOT, query='token', budget=12000)['text']
print('test_self_description.py: all assertions passed')
