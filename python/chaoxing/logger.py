import os, sys, time as _time, tempfile
from loguru import logger

log_dir = os.path.join(tempfile.gettempdir(), 'AutomaticCB')
log_path = os.path.join(log_dir, 'chaoxing.log')
try:
    if os.path.exists(log_path) and not os.access(log_path, os.W_OK):
        log_path = os.path.join(log_dir, 'chaoxing_%s.log' % _time.strftime('%Y-%m-%d_%H-%M-%S'))
    logger.add(log_path, rotation='10 MB', level='TRACE',
                format='{time:YYYY-MM-DD HH:mm:ss} | {level} | {message}')
except Exception:
    try:
        logger.add(sys.stderr, level='DEBUG')
    except Exception:
        pass