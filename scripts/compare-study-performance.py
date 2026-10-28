#!/usr/bin/env python3
"""Run sequential, pinned synthetic study comparisons using one common workload."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def manifest(root):
    return {
        str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(root.rglob('*'))
        if path.is_file() and 'node_modules' not in path.parts
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True)
    parser.add_argument('--head', required=True)
    parser.add_argument('--repetitions', type=int, default=3, choices=range(1, 6))
    parser.add_argument('--profiles', nargs='+', default=['small', 'history', 'diverse'],
                        choices=['small', 'bank', 'history', 'diverse'])
    args = parser.parse_args()
    os.umask(0o077)
    repository = Path(subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip())
    evidence = Path(tempfile.mkdtemp(prefix='study-performance-'))
    print(evidence, flush=True)
    (evidence / 'compare-study-performance.py').write_bytes(Path(__file__).read_bytes())
    (evidence / 'dependency-lock.json').write_bytes((repository / 'package-lock.json').read_bytes())
    common = ['foreground-benchmark.ts', 'foreground-benchmark-worker.ts',
              'benchmark-history-evidence.ts', 'benchmark-worker-lifetime.ts',
              'performance-metrics.ts', 'answered-benchmark-history.ts']
    metadata = {'workloadVersion': 'study-history-v2-answered', 'repetitions': args.repetitions,
                'node': subprocess.check_output(['node', '--version'], text=True).strip(),
                'dependencyPolicy': 'reuse current harness node_modules; dependency-lock.json records installed lockfile',
                'profiles': args.profiles, 'revisions': {}, 'runOrder': []}
    if not metadata['node'].startswith('v24.'):
        raise SystemExit('Use the repository-supported Node 24 on PATH; no runtime is installed by this script.')
    for label, revision in [('base', args.base), ('head', args.head)]:
        sha = subprocess.check_output(['git', 'rev-parse', revision], text=True).strip()
        source = evidence / f'{label}-source'
        source.mkdir()
        archive = subprocess.check_output(['git', 'archive', sha])
        with tarfile.open(fileobj=io.BytesIO(archive)) as tree:
            tree.extractall(source, filter='data')
        for path in source.rglob('*'):
            path.chmod(0o700 if path.is_dir() else 0o600)
        nest = (source / 'src/server/application.ts').exists()
        adapter = 'foreground-benchmark-worker.ts' if nest else 'foreground-benchmark-legacy-worker.ts'
        overlays = [name for name in common if name != 'foreground-benchmark-worker.ts'] + [adapter]
        (evidence / f'{label}-archive.tar').write_bytes(archive)
        originals = {}
        for name in overlays:
            destination = source / 'tests' / name
            originals[f'tests/{name}'] = destination.read_text() if destination.exists() else None
            snapshot = name + '.fixture' if name == 'foreground-benchmark-legacy-worker.ts' else name
            destination.write_bytes((repository / 'tests' / snapshot).read_bytes())
        if nest:
            config_path = source / 'tsconfig.server.json'
            originals['tsconfig.server.json'] = config_path.read_text()
            config = json.loads(originals['tsconfig.server.json'])
            if 'tests/foreground-benchmark-worker.ts' not in config['include']:
                config['include'].append('tests/foreground-benchmark-worker.ts')
            config_path.write_text(json.dumps(config, indent=2) + '\n')
        # Unified patches preserve the exact common-harness overlay for each pinned commit.
        import difflib
        patch = ''
        for name, original in originals.items():
            patch += ''.join(difflib.unified_diff((original or '').splitlines(keepends=True),
                             (source / name).read_text().splitlines(keepends=True),
                             fromfile=f'a/{name}' if original is not None else '/dev/null', tofile=f'b/{name}'))
        (evidence / f'{label}-measured.patch').write_text(patch)
        (evidence / f'{label}-manifest.json').write_text(json.dumps(manifest(source), indent=2) + '\n')
        (source / 'node_modules').symlink_to((repository / 'node_modules').resolve(), target_is_directory=True)
        metadata['revisions'][label] = {'sha': sha, 'transport': 'nest-session/compiled/manual-upkeep' if nest else 'legacy-manual-dispatch/session-bypass/native'}
        if nest:
            with (evidence / f'{label}-build.log').open('w') as log:
                run('npm', 'run', 'build:server', cwd=source, stdout=log, stderr=subprocess.STDOUT)
            (evidence / f'{label}-emitted-manifest.json').write_text(json.dumps(manifest(source / 'build'), indent=2) + '\n')
        for profile in args.profiles:
            metadata['runOrder'].append(f'{label} {sha} {profile} {args.repetitions}')
            (evidence / 'run.json').write_text(json.dumps(metadata, indent=2) + '\n')
            print(metadata['runOrder'][-1], flush=True)
            with (evidence / f'{label}-{profile}.log').open('w') as log:
                run('node', 'tests/foreground-benchmark.ts', profile, str(args.repetitions),
                    cwd=source, stdout=log, stderr=subprocess.STDOUT,
                    env={**os.environ, 'STUDY_BENCHMARK_TRANSPORT': 'nest' if nest else 'legacy'})
    print('Finished sequential comparisons. Review logs and append sanitized results to docs/performance-ledger.md.')


if __name__ == '__main__':
    main()
