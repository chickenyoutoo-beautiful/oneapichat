#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
StarRailCopilot REST API Blueprint
Provides /src/* endpoints for AI and frontend to query/configure/control SRC.
"""
import sys
import os
import json
import threading
import re
from pathlib import Path
from datetime import datetime

from flask import Blueprint, jsonify, request

# Add SRC to import path
SRC_DIR = str(Path(__file__).resolve().parent.parent / "StarRailCopilot")
if SRC_DIR not in sys.path:
    sys.path.insert(0, SRC_DIR)

# SRC's config utils use relative paths (./config/). Patch to resolve against SRC_DIR.
def _patch_src_path():
    try:
        from module.config import utils as cfg_utils
        def _patched(filename, mod_name='alas'):
            if mod_name == 'alas':
                return os.path.join(SRC_DIR, 'config', f'{filename}.json')
            else:
                return os.path.join(SRC_DIR, 'config', f'{filename}.{mod_name}.json')
        cfg_utils.filepath_config = _patched
    except Exception:
        pass

_patch_src_path()

src_bp = Blueprint('src', __name__, url_prefix='/src')

# Thread safety for ProcessManager operations
_lock = threading.Lock()
_pm_cache = {}  # config_name -> ProcessManager

# Friendly task descriptions (i18n keys from SRC)
TASK_DESCRIPTIONS = {
    'Alas': '完整调度器，按优先级依次执行所有已启用的任务',
    'Restart': '重启游戏客户端',
    'Dungeon': '刷副本：拟造花萼、侵蚀隧洞、凝滞虚影等，消耗开拓力',
    'Ornament': '刷内圈遗器：差分宇宙·千面xx，消耗开拓力或沉浸器',
    'DailyQuest': '完成每日实训任务，领取活跃度奖励',
    'BattlePass': '领取无名勋礼（大月卡）奖励',
    'Assignment': '收派委托（派遣角色获取材料）',
    'DataUpdate': '更新游戏内数据：信用点、星琼、燃料等资源统计',
    'Freebies': '领取免费奖励：邮件、兑换码、助战奖励',
    'Weekly': '刷历战余响（周本），消耗开拓力',
    'Rogue': '刷模拟宇宙（差分宇宙），可设置祝福/奇物/事件策略',
    'Daemon': '后台托管模式：自动启停模拟器+游戏，循环清体力',
    'PlannerScan': '角色养成规划扫描：读取角色/光锥材料需求',
}

TASK_GROUPS = [
    {'name': 'Main', 'label': '基础', 'tasks': ['Alas', 'Restart']},
    {'name': 'Daily', 'label': '日常', 'tasks': ['Dungeon', 'Ornament', 'DailyQuest', 'BattlePass', 'Assignment', 'DataUpdate', 'Freebies']},
    {'name': 'Weekly', 'label': '周常', 'tasks': ['Weekly', 'Rogue']},
    {'name': 'Tool', 'label': '工具', 'tasks': ['Daemon', 'PlannerScan']},
]

DEFAULT_CONFIG_NAME = 'src'


# ── helpers ──

def _get_config(config_name=None):
    """Lazy-load AzurLaneConfig for a given instance name."""
    name = config_name or DEFAULT_CONFIG_NAME
    from module.config.config import AzurLaneConfig
    try:
        return AzurLaneConfig(name)
    except FileNotFoundError:
        return None
    except Exception as e:
        return None


def _ensure_state():
    """Initialize SRC State (multiprocessing.Manager) if not already done."""
    from module.webui.setting import State
    if State.manager is None:
        State.init()


def _have_pm(config_name=None):
    """Check if ProcessManager exists without creating one."""
    name = config_name or DEFAULT_CONFIG_NAME
    return name in _pm_cache


def _get_pm(config_name=None):
    """Get or create ProcessManager for a config name.
    Returns None if multiprocessing.Manager is not initialized.
    """
    name = config_name or DEFAULT_CONFIG_NAME
    with _lock:
        if name not in _pm_cache:
            try:
                _ensure_state()
                from module.webui.process_manager import ProcessManager
                _pm_cache[name] = ProcessManager.get_manager(name)
            except Exception:
                return None
        return _pm_cache.get(name)


def _safe_int(v, default=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _safe_float(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _config_dict(config):
    """Extract safe dict from AzurLaneConfig. Handles lazy data access."""
    if config is None:
        return {}
    try:
        return config.data if hasattr(config, 'data') else {}
    except Exception:
        return {}


def _task_status(config, task_name):
    """Extract task scheduler status from config data."""
    data = _config_dict(config)
    task_data = data.get(task_name, {})
    scheduler = task_data.get('Scheduler', {})
    return {
        'name': task_name,
        'enable': scheduler.get('Enable', False),
        'command': scheduler.get('Command', task_name),
        'next_run': str(scheduler.get('NextRun', '')),
        'description': TASK_DESCRIPTIONS.get(task_name, ''),
    }


def _stored_value(config, path, default=0):
    """Safe read from config stored data."""
    if config is None:
        return default
    try:
        from module.config.deep import deep_get
        return deep_get(config.data, keys=path, default=default)
    except Exception:
        return default


# ── endpoints ──

@src_bp.route('/status')
def src_status():
    """GET /src/status — SRC process status."""
    config_name = request.args.get('config_name', DEFAULT_CONFIG_NAME)
    try:
        if not _have_pm(config_name):
            return jsonify({
                'ok': True, 'config_name': config_name,
                'alive': False, 'state': 2, 'state_label': 'stopped',
            })
        pm = _get_pm(config_name)
        if pm is None:
            return jsonify({'ok': True, 'config_name': config_name,
                'alive': False, 'state': 0, 'state_label': 'unavailable'})
        alive = pm.alive
        state = pm.state
        state_labels = {1: 'running', 2: 'stopped', 3: 'error', 4: 'updating'}
        return jsonify({
            'ok': True, 'config_name': config_name,
            'alive': alive, 'state': state,
            'state_label': state_labels.get(state, 'unknown'),
        })
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e), 'alive': False, 'state': 0, 'state_label': 'unavailable'}), 200


@src_bp.route('/tasks')
def src_tasks():
    """GET /src/tasks — List all tasks with their current status."""
    config_name = request.args.get('config_name', DEFAULT_CONFIG_NAME)
    try:
        config = _get_config(config_name)
        groups_out = []
        all_tasks = []
        for group in TASK_GROUPS:
            tasks = [_task_status(config, t) for t in group['tasks']]
            groups_out.append({'name': group['name'], 'label': group['label'], 'tasks': tasks})
            all_tasks.extend(tasks)
        return jsonify({'ok': True, 'groups': groups_out, 'tasks': all_tasks})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e), 'groups': [], 'tasks': []}), 200


@src_bp.route('/config/<config_name>')
def src_config_get(config_name):
    """GET /src/config/<name> — Read full config."""
    try:
        config = _get_config(config_name)
        if config is None:
            # Try reading raw file
            from module.config.utils import read_file, filepath_config
            raw = read_file(filepath_config(config_name))
            if not raw:
                return jsonify({'ok': False, 'error': 'Config not found'}), 404
            return jsonify({'ok': True, 'config_name': config_name, 'data': raw})
        return jsonify({'ok': True, 'config_name': config_name, 'data': _config_dict(config)})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'ok': False, 'error': str(e), 'traceback': traceback.format_exc()}), 500


@src_bp.route('/config/<config_name>', methods=['PUT'])
def src_config_update(config_name):
    """PUT /src/config/<name> — Update config value(s).
    Body: {"path": "Dungeon.Scheduler.Enable", "value": true}
      or: {"updates": [{"path": "...", "value": ...}, ...]}
    """
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({'ok': False, 'error': 'Invalid JSON body'}), 400

        updates = data.get('updates', [])
        if not updates and 'path' in data:
            updates = [{'path': data['path'], 'value': data['value']}]
        if not updates:
            return jsonify({'ok': False, 'error': 'Missing path/value or updates'}), 400

        config = _get_config(config_name)
        if config is None:
            return jsonify({'ok': False, 'error': 'Config not found'}), 404

        from module.config.deep import deep_set
        applied = []
        for upd in updates:
            path = upd['path']
            value = upd['value']
            deep_set(config.data, keys=path, value=value)
            config.modified[path] = value
            applied.append({'path': path, 'value': value})

        config.save()
        return jsonify({'ok': True, 'applied': applied})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'ok': False, 'error': str(e), 'traceback': traceback.format_exc()}), 500


@src_bp.route('/run', methods=['POST'])
def src_run():
    """POST /src/run — Start SRC scheduler or single task.
    Body: {"config_name": "src", "task": "Dungeon"}  (task optional, default=Alas scheduler)
    """
    try:
        data = request.get_json(silent=True) or {}
        config_name = data.get('config_name', DEFAULT_CONFIG_NAME)
        task = data.get('task', 'Alas')

        valid_tasks = [t for g in TASK_GROUPS for t in g['tasks']]
        if task not in valid_tasks:
            return jsonify({'ok': False, 'error': f'Unknown task: {task}', 'valid_tasks': valid_tasks}), 400

        pm = _get_pm(config_name)
        if pm is None:
            return jsonify({'ok': False, 'error': 'SRC backend unavailable'}), 503
        if pm.alive:
            return jsonify({'ok': False, 'error': 'Already running. Stop first.'}), 409
        
        # ★ 强制重置：如果 PM 处于 error(3)/stopped(2) 状态，清理缓存重建
        if pm.state >= 2 and not pm.alive:
            pm.stop()
            import time
            time.sleep(0.5)
            if config_name in _pm_cache:
                del _pm_cache[config_name]
                pm = _get_pm(config_name)
                if pm is None:
                    return jsonify({'ok': False, 'error': 'Failed to recreate PM'}), 503

        import inflection
        func = inflection.underscore(task) if task != 'Alas' else 'alas'
        pm.start(func)
        return jsonify({'ok': True, 'config_name': config_name, 'task': task, 'func': func})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'ok': False, 'error': str(e), 'traceback': traceback.format_exc()}), 500


@src_bp.route('/stop', methods=['POST'])
def src_stop():
    """POST /src/stop — Stop running SRC process."""
    try:
        data = request.get_json(silent=True) or {}
        config_name = data.get('config_name', DEFAULT_CONFIG_NAME)

        if not _have_pm(config_name):
            return jsonify({'ok': False, 'error': 'Not running'}), 409
        pm = _get_pm(config_name)
        if pm is None or not pm.alive:
            return jsonify({'ok': False, 'error': 'Not running'}), 409

        pm.stop()
        return jsonify({'ok': True, 'config_name': config_name, 'message': 'Stopped'})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'ok': False, 'error': str(e), 'traceback': traceback.format_exc()}), 500


@src_bp.route('/dashboard')
def src_dashboard():
    """GET /src/dashboard — Resource overview."""
    config_name = request.args.get('config_name', DEFAULT_CONFIG_NAME)
    try:
        config = _get_config(config_name)
        if config is None:
            return jsonify({'ok': True, 'resources': {}, 'note': 'No config yet'})

        # Read stored values from config
        resources = {}
        stored_paths = {
            'trailblaze_power': 'Dungeon.DungeonStorage.TrailblazePower',
            'daily_activity': 'DailyQuest.DailyStorage.DailyActivity',
            'relic': 'Dungeon.DungeonStorage.Relic',
            'planner_overall': 'Dungeon.DungeonStorage.PlannerOverall',
            'battle_pass_level': 'BattlePass.BattlePassStorage.BattlePassLevel',
            'simulated_universe': 'Rogue.RogueStorage.SimulatedUniverse',
            'credit': 'DataUpdate.DataUpdateStorage.Credit',
            'stellar_jade': 'DataUpdate.DataUpdateStorage.StallerJade',
            'reserved_power': 'Dungeon.DungeonStorage.Reserved',
            'fuel': 'Dungeon.DungeonStorage.Fuel',
            'immersifier': 'Dungeon.DungeonStorage.Immersifier',
            'echo_of_war': 'Weekly.WeeklyStorage.EchoOfWar',
            'assignment': 'Assignment.AssignmentStorage.Assignment',
        }

        for key, path in stored_paths.items():
            val = _stored_value(config, f'{path}.value', None)
            total = _stored_value(config, f'{path}.total', None)
            t = _stored_value(config, f'{path}.time', '')
            resources[key] = {
                'value': _safe_int(val) if val is not None else 0,
                'total': _safe_int(total) if total is not None else None,
                'time': str(t) if t else '',
            }

        # Double event info
        double = {}
        for sub in ['calyx', 'relic', 'rogue']:
            double[sub] = _safe_int(_stored_value(config, f'Dungeon.DungeonStorage.DungeonDouble.{sub}', 0))
        resources['dungeon_double'] = double

        return jsonify({'ok': True, 'resources': resources, 'updated_at': datetime.now().isoformat()})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e), 'resources': {}}), 200


@src_bp.route('/logs')
def src_logs():
    """GET /src/logs — Recent log output."""
    config_name = request.args.get('config_name', DEFAULT_CONFIG_NAME)
    limit = _safe_int(request.args.get('limit', 50), 50)
    try:
        if not _have_pm(config_name):
            return jsonify({'ok': True, 'lines': [], 'count': 0, 'note': 'Not started yet'})
        pm = _get_pm(config_name)
        if pm is None:
            return jsonify({'ok': True, 'lines': [], 'count': 0})
        renderables = getattr(pm, 'renderables', []) or []
        entries = []
        for r in renderables[-limit:]:
            try:
                if hasattr(r, 'markup'):
                    entries.append(str(r.markup))
                elif hasattr(r, 'text'):
                    entries.append(r.text)
                else:
                    entries.append(str(r))
            except Exception:
                entries.append(str(r))
        return jsonify({'ok': True, 'lines': entries, 'count': len(entries)})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e), 'lines': []}), 200


@src_bp.route('/args/<task_name>')
def src_args(task_name):
    """GET /src/args/<task> — Argument schema for building config forms."""
    try:
        from module.config.utils import read_file
        args_file = os.path.join(SRC_DIR, 'module', 'config', 'argument', 'args.json')
        all_args = read_file(args_file)
        if not isinstance(all_args, dict):
            import json
            all_args = json.loads(all_args)
        task_args = all_args.get(task_name, {})
        if not task_args:
            return jsonify({'ok': False, 'error': f'Task "{task_name}" not found'}), 404
        return jsonify({'ok': True, 'task': task_name, 'args': task_args})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e), 'args': {}}), 200


@src_bp.route('/configs')
def src_configs():
    """GET /src/configs — List available config instances."""
    try:
        from module.config.utils import alas_instance
        return jsonify({
            'ok': True,
            'instances': alas_instance(),
        })
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e), 'instances': []}), 200


@src_bp.route('/ping')
def src_ping():
    """GET /src/ping — Health check. Returns whether SRC modules are importable."""
    return jsonify({
        'ok': True,
        'src_dir': SRC_DIR,
        'src_available': os.path.isdir(SRC_DIR),
        'time': datetime.now().isoformat(),
    })
