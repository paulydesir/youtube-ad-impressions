#!/usr/bin/env python3
"""Switch this checkout between local development and the hosted backend."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
STATE = ROOT / '.zap'
ENV_KEYS = ('APP_ENV', 'DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY',
            'SERVER_URL', 'PORT', 'HOST', 'MCP_RESOURCE_URL', 'POSTGRES_USER',
            'POSTGRES_PASSWORD', 'POSTGRES_DB', 'POSTGRES_PORT')


def run(args, **kwargs):
    print('⚡ ' + shlex.join(map(str, args)), flush=True)
    return subprocess.run(args, cwd=ROOT, check=True, **kwargs)


def env_file(path):
    # Use the same dotenv parser as the server; never source shell code.
    result = subprocess.run(['node', '--input-type=module', '-e',
        'import dotenv from "./apps/server/node_modules/dotenv/lib/main.js"; '
        'import fs from "node:fs"; '
        'console.log(JSON.stringify(dotenv.parse(fs.readFileSync(process.argv[1]))));',
        str(path)], cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        # npm may hoist dotenv to the root.
        result = subprocess.run(['node', '--input-type=module', '-e',
            'import dotenv from "dotenv"; import fs from "node:fs"; '
            'console.log(JSON.stringify(dotenv.parse(fs.readFileSync(process.argv[1]))));',
            str(path)], cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f'Cannot read {path.relative_to(ROOT)}; check the file and run npm install.')
    return json.loads(result.stdout)


def environment(prod=False):
    env = {k: v for k, v in os.environ.items() if k not in ENV_KEYS}
    paths = ([ROOT / 'apps/extension/.env.production'] if prod else
             [ROOT / '.env', ROOT / 'apps/server/.env', ROOT / 'apps/server/.env.development.local'])
    for path in paths:
        if path.exists():
            env.update(env_file(path))
        elif prod:
            raise RuntimeError('Create apps/extension/.env.production from its example first.')
    if not prod:
        env['APP_ENV'] = 'development'
        env.setdefault('HOST', '127.0.0.1')
        env.setdefault('PORT', '8787')
        env.setdefault('SUPABASE_URL', 'http://127.0.0.1:54321')
        env['SERVER_URL'] = f"http://127.0.0.1:{env['PORT']}"
        env.setdefault('MCP_RESOURCE_URL', env['SERVER_URL'] + '/mcp')
        for key in ('DATABASE_URL', 'SUPABASE_URL', 'SERVER_URL'):
            if urlparse(env.get(key, '')).hostname not in ('localhost', '127.0.0.1', '::1'):
                raise RuntimeError(f'{key} must point to localhost for zap dev; check apps/server/.env.')
    else:
        for key in ('SERVER_URL', 'SUPABASE_URL'):
            url = urlparse(env.get(key, ''))
            if url.scheme != 'https' or not url.hostname or url.hostname in ('localhost', '127.0.0.1', '::1'):
                raise RuntimeError(f'Set a hosted HTTPS {key} in apps/extension/.env.production.')
        if not env.get('SUPABASE_PUBLISHABLE_KEY'):
            raise RuntimeError('Set SUPABASE_PUBLISHABLE_KEY in apps/extension/.env.production.')
    return env


def docker_ready():
    return subprocess.run(['docker', 'info'], stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL).returncode == 0


def start_docker():
    if docker_ready():
        return
    if sys.platform != 'darwin':
        raise RuntimeError('Start Docker, then run zap dev again.')
    run(['open', '-a', 'Docker'])
    until = time.monotonic() + 120
    while time.monotonic() < until:
        if docker_ready():
            return
        time.sleep(2)
    raise RuntimeError('Docker did not become ready within 120 seconds.')


def identity(pid):
    # npm changes its process title after launch; the start time stays stable.
    result = subprocess.run(['ps', '-p', str(pid), '-o', 'lstart='],
                            capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else ''


def managed_server():
    path = STATE / 'server.json'
    if not path.exists():
        return None
    record = json.loads(path.read_text())
    if identity(record['pid']) == record['identity'] and record['identity']:
        return record
    path.unlink()
    return None


def stop_server():
    record = managed_server()
    if not record:
        return
    pid = record['pid']
    if os.getpgid(pid) != pid:
        raise RuntimeError('Server process group changed; refusing to stop it.')
    print('⚡ Stopping the server started by zap', flush=True)
    os.killpg(pid, signal.SIGTERM)
    until = time.monotonic() + 10
    while time.monotonic() < until:
        try:
            os.killpg(pid, 0)
        except ProcessLookupError:
            break
        time.sleep(0.2)
    else:
        os.killpg(pid, signal.SIGKILL)
    (STATE / 'server.json').unlink(missing_ok=True)


def start_server(env):
    stop_server()
    with socket.socket() as probe:
        if probe.connect_ex(('127.0.0.1', int(env['PORT']))) == 0:
            raise RuntimeError(f"Port {env['PORT']} is occupied by a server zap does not own. Stop it first.")
    with (STATE / 'server.log').open('ab') as log:
        process = subprocess.Popen(['npm', 'run', 'dev'], cwd=ROOT, env=env,
                                   stdout=log, stderr=log, start_new_session=True)
    (STATE / 'server.json').write_text(json.dumps({'pid': process.pid, 'identity': identity(process.pid)}))
    until = time.monotonic() + 90
    while time.monotonic() < until:
        if process.poll() is not None:
            break
        try:
            with urllib.request.urlopen(env['SERVER_URL'] + '/healthz', timeout=2) as response:
                if response.status == 200:
                    print('⚡ Server ready: ' + env['SERVER_URL'])
                    return
        except (OSError, ValueError):
            pass
        time.sleep(1)
    stop_server()
    raise RuntimeError('Server failed its health check. See .zap/server.log.')


def build_extension(env, prod):
    # Build away from Chrome's live files. Publish the reload marker LAST.
    staging = STATE / 'extension-build'
    build_env = dict(env, ZAP_OUT_DIR=str(staging))
    run(['npm', 'run', 'build:extension:prod' if prod else 'build:extension'], env=build_env)
    import uuid
    token = uuid.uuid4().hex
    helper = (ROOT / 'scripts/zap-reload.js').read_text().replace('__ZAP_BUILD__', json.dumps(token))
    with (staging / 'background.js').open('a') as output:
        output.write('\n' + helper)
    dist = ROOT / 'apps/extension/dist'
    dist.mkdir(exist_ok=True)
    (dist / 'zap-build.json').unlink(missing_ok=True)
    shutil.copytree(staging, dist, dirs_exist_ok=True)
    marker = dist / 'zap-build.json.tmp'
    marker.write_text(json.dumps({'build': token}))
    marker.replace(dist / 'zap-build.json')
    print('⚡ Extension built. Chrome will pick it up on its next reload check.')
    print('   First use: load/reload apps/extension at chrome://extensions (Developer mode).')
    print('   Refresh existing YouTube tabs after switching environments.')


def stop_local(env):
    stop_server()
    if docker_ready():
        run(['node_modules/.bin/supabase', 'stop'], env=env)
        run(['docker', 'compose', 'stop', 'db'], env=env)
    else:
        print('⚡ Docker is already stopped.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('environment', choices=['dev', 'prod', 'stop', 'status'])
    parser.add_argument('--dry-run', action='store_true', help='Show the steps without changing anything')
    args = parser.parse_args()
    plans = {
        'dev': 'Start Docker → Supabase → Postgres → local migrations → server → dev extension + reload marker',
        'prod': 'Build prod extension + reload marker → stop zap server → stop local Supabase + Postgres (keep data)',
        'stop': 'Stop zap server → stop local Supabase + Postgres (keep data)',
        'status': 'Show the zap-managed server and log path',
    }
    if args.dry_run:
        print(plans[args.environment])
        return
    STATE.mkdir(exist_ok=True)
    with (STATE / 'lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Another zap command is running.')
        if args.environment == 'status':
            server = managed_server()
            print(f"Server: PID {server['pid']}" if server else 'Server: not running under zap')
            print(f'Log: {STATE / "server.log"}')
            return
        for command in ('node', 'npm', 'docker'):
            if not shutil.which(command):
                raise RuntimeError(f'Install {command} first.')
        if not (ROOT / 'node_modules/.bin/supabase').exists():
            run(['npm', 'install'])
        if args.environment == 'dev':
            env = environment()
            start_docker()
            run(['node_modules/.bin/supabase', 'start'], env=env)
            run(['node_modules/.bin/supabase', 'db', 'push', '--local', '--yes'], env=env)
            status = subprocess.run(['node_modules/.bin/supabase', 'status', '-o', 'json'],
                                    cwd=ROOT, env=env, capture_output=True, text=True, check=True)
            local = json.loads(status.stdout)
            env['SUPABASE_URL'] = local['API_URL']
            env['SUPABASE_PUBLISHABLE_KEY'] = local.get('PUBLISHABLE_KEY') or local['ANON_KEY']
            run(['docker', 'compose', 'up', '-d', '--wait', 'db'], env=env)
            run(['npm', 'run', 'migrate'], env=env)
            start_server(env)
            build_extension(env, False)
        elif args.environment == 'prod':
            build_extension(environment(prod=True), True)
            # Stopping containers needs local Compose settings, not hosted credentials.
            env = dict(os.environ)
            for path in (ROOT / '.env', ROOT / 'apps/server/.env', ROOT / 'apps/server/.env.development.local'):
                if path.exists():
                    env.update(env_file(path))
            stop_local(env)
        else:
            stop_local(os.environ.copy())


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(f'zap: {error}', file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print('\nzap: interrupted; use zap stop to stop local services.', file=sys.stderr)
        sys.exit(130)
