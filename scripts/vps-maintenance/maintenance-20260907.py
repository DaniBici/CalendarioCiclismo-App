#!/usr/bin/env python3
"""Mantenimiento único del VPS, autorizado para el 7 de septiembre de 2026."""

import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo


ROOT = Path('/var/lib/cc-maintenance-20260907')
STATE = ROOT / 'state.json'
MADRID = ZoneInfo('Europe/Madrid')
START = datetime(2026, 9, 7, 3, 30, tzinfo=MADRID)
STOP = datetime(2026, 9, 7, 4, 15, tzinfo=MADRID)
SELF = 'cc-maintenance-20260907'
ASSET = 'https://assets.calendariociclismo.app/1775028926893-logo-tour-de-bulgaria.webp'


def run(*args, capture=False, env=None):
    result = subprocess.run(args, check=True, text=True,
                            stdout=subprocess.PIPE if capture else None, env=env)
    return result.stdout.strip() if capture else None


def save(state, stage):
    state.update(stage=stage, updated_at=datetime.now(timezone.utc).isoformat())
    temp = STATE.with_suffix('.tmp')
    temp.write_text(json.dumps(state, indent=2) + '\n')
    temp.replace(STATE)
    print(f'{state["updated_at"]} {stage}', flush=True)


def units(kind, states):
    output = run('systemctl', 'list-units', f'--type={kind}', f'--state={states}',
                 '--plain', '--no-legend', '--no-pager', f'cc-*.{kind}', capture=True)
    return [line.split()[0] for line in output.splitlines()
            if line.strip() and not line.split()[0].startswith(SELF)]


def preflight():
    run('nginx', '-t')
    run('/usr/sbin/sshd', '-t')
    for unit in ('nginx.service', 'ssh.socket'):
        run('systemctl', 'is-active', '--quiet', unit)
        run('systemctl', 'is-enabled', '--quiet', unit)
    if run('dpkg', '--audit', capture=True):
        raise RuntimeError('Hay paquetes pendientes de configurar; no se actualizará.')
    free = os.statvfs('/')
    if free.f_bavail * free.f_frsize < 4 * 1024**3:
        raise RuntimeError('Quedan menos de 4 GiB libres.')
    backup = json.loads((ROOT / 'offsite-backup.json').read_text())
    created = datetime.fromisoformat(backup['created_at'])
    if (not backup.get('drive_file_id') or not backup.get('sha256')
            or not backup.get('restore_verified')
            or datetime.now(timezone.utc) - created > timedelta(days=7)):
        raise RuntimeError('La copia externa verificada falta o tiene más de siete días.')
    run('curl', '--fail', '--silent', '--show-error', '--max-time', '30',
        '--output', '/dev/null', ASSET)
    print('Preflight correcto; no se han actualizado paquetes ni reiniciado servicios.', flush=True)


def apply():
    now = datetime.now(MADRID)
    if not START <= now < STOP:
        raise RuntimeError('Fuera de la ventana autorizada del 7 de septiembre.')
    if STATE.exists():
        raise RuntimeError('El mantenimiento ya se intentó; requiere revisión antes de repetirlo.')
    preflight()
    state = {'boot_before': Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
             'kernel_before': run('uname', '-r', capture=True),
             'timers': units('timer', 'active')}
    save(state, 'preparando')
    reboot_requested = False
    try:
        if state['timers']:
            run('systemctl', 'stop', *state['timers'])
        save(state, 'esperando_tareas')
        while units('service', 'active,activating'):
            if datetime.now(MADRID) >= STOP:
                raise RuntimeError('La ventana terminó con tareas activas; no se interrumpen.')
            time.sleep(15)
        if datetime.now(MADRID) >= STOP:
            raise RuntimeError('La ventana terminó antes de iniciar las actualizaciones.')
        backup = Path('/root/maintenance/20260907-paquetes')
        backup.mkdir(mode=0o700, parents=True, exist_ok=False)
        run('tar', '-czf', str(backup / 'config-antes.tar.gz'), '-C', '/',
            'etc', 'usr/local/sbin/cc-maintenance-20260907', 'var/lib/cc-maintenance-20260907')
        (backup / 'paquetes-antes.txt').write_text(run('dpkg-query', '-W', capture=True) + '\n')
        save(state, 'actualizando')
        env = dict(os.environ, DEBIAN_FRONTEND='noninteractive', NEEDRESTART_MODE='l')
        run('apt-get', '-o', 'DPkg::Lock::Timeout=600', '-o', 'Acquire::Retries=3',
            '-o', 'APT::Update::Error-Mode=any', 'update', env=env)
        run('apt-get', '-y', '-o', 'DPkg::Lock::Timeout=600',
            '-o', 'Dpkg::Options::=--force-confdef', '-o', 'Dpkg::Options::=--force-confold',
            'upgrade', env=env)
        run('nginx', '-t')
        run('/usr/sbin/sshd', '-t')
        if run('dpkg', '--audit', capture=True):
            raise RuntimeError('La actualización dejó paquetes sin configurar; no se reinicia.')
        (backup / 'paquetes-despues.txt').write_text(run('dpkg-query', '-W', capture=True) + '\n')
        kernels = [p.name.removeprefix('vmlinuz-') for p in Path('/boot').glob('vmlinuz-*') if p.is_file()]
        state['kernel_expected'] = max(kernels, key=lambda name: tuple(map(int, re.findall(r'\d+', name))))
        save(state, 'reinicio_solicitado')
        run('systemctl', 'reboot', '--no-block')
        reboot_requested = True
    except Exception as error:
        state['error'] = str(error)
        save(state, 'error')
        raise
    finally:
        if not reboot_requested and state['timers']:
            run('systemctl', 'start', *state['timers'])


def verify():
    state = json.loads(STATE.read_text())
    if state['stage'] == 'completado':
        print('Mantenimiento ya verificado.')
        return
    if state['stage'] != 'reinicio_solicitado':
        raise RuntimeError(f'Estado no verificable: {state["stage"]}')
    current_boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    if current_boot == state['boot_before']:
        raise RuntimeError('El servidor todavía no se ha reiniciado.')
    run('nginx', '-t')
    run('/usr/sbin/sshd', '-t')
    for unit in ('nginx.service', 'ssh.socket', *state['timers']):
        run('systemctl', 'is-active', '--quiet', unit)
    if run('dpkg', '--audit', capture=True):
        raise RuntimeError('Hay paquetes pendientes tras el reinicio.')
    if Path('/run/reboot-required').exists():
        raise RuntimeError('El sistema continúa solicitando reinicio.')
    for url in (ASSET, 'https://calendariociclismo.app/feed/2026.ics'):
        run('curl', '--fail', '--silent', '--show-error', '--retry', '5',
            '--retry-delay', '10', '--retry-all-errors', '--max-time', '30',
            '--output', '/dev/null', url)
    kernel = run('uname', '-r', capture=True)
    if kernel != state['kernel_expected']:
        raise RuntimeError(f'Kernel arrancado {kernel}; se esperaba {state["kernel_expected"]}.')
    state.update(boot_after=current_boot, kernel_after=kernel)
    save(state, 'completado')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('check', 'apply', 'verify'))
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit('Se requiere root.')
    os.umask(0o077)
    ROOT.mkdir(mode=0o700, exist_ok=True)
    with (ROOT / 'maintenance.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        {'check': preflight, 'apply': apply, 'verify': verify}[args.mode]()


if __name__ == '__main__':
    main()
