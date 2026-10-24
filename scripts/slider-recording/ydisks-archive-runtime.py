import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile

root = Path(os.environ['XIANYU_COPY_INPUT_DIR'])
prefix = Path(sys.base_prefix)
files = [p for p in prefix.iterdir() if p.is_file() and p.suffix.lower() in ['.exe', '.dll', '.zip', '._pth']]
for name in ['Lib', 'DLLs']:
    if (prefix / name).exists():
        files.extend(p for p in (prefix / name).rglob('*') if p.is_file() and 'site-packages' not in p.parts and '__pycache__' not in p.parts)
if not (root / 'python-runtime.tar.gz').exists():
    with tarfile.open(root / 'python-runtime.tar.gz', 'w:gz', compresslevel=2) as archive:
        for file in files:
            archive.add(file, arcname=file.relative_to(prefix), recursive=False)
(root / 'python-runtime.json').write_text(json.dumps({'version': sys.version, 'executable': sys.executable,
    'basePrefix': str(prefix), 'files': len(files), 'executableSha256': hashlib.sha256(Path(sys.executable).read_bytes()).hexdigest()}, indent=2), encoding='utf-8')
main = Path('F:/ChenHai/Project/XianYuAgent')
packages = ['patchright', 'patchright-core', 'ws', 'esbuild', '@esbuild/win32-x64', 'tsx', 'get-tsconfig', 'resolve-pkg-maps', 'typescript']
entries = [f'node_modules/{name}' for name in packages if (main / 'node_modules' / name).exists()]
process = subprocess.run(['tar', '-czf', str(root / 'node-modules-full.tar.gz'), '-C', str(main), 'node_modules'], capture_output=True)
(root / 'archive-node-dependencies.stdout.log').write_bytes(process.stdout)
(root / 'archive-node-dependencies.stderr.log').write_bytes(process.stderr)
if process.returncode:
    raise SystemExit(process.returncode)
versions = {name: json.loads((main / 'node_modules' / name / 'package.json').read_text(encoding='utf-8'))['version'] for name in packages
            if (main / 'node_modules' / name / 'package.json').exists()}
(root / 'diagnostic-package-versions.json').write_text(json.dumps(versions, indent=2), encoding='utf-8')
print(json.dumps({'pythonFiles': len(files), 'archivedNodePackages': len(entries)}))
