import os
import sys
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "postgresql://unused/unused")  # never connected to: tests stub db()
os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret")
os.environ.setdefault("APP_USER_EMAIL", "staff@example.com")
os.environ.setdefault("APP_USER_PASSWORD", "pw")
os.environ.setdefault("CRON_SECRET", "cron")
sys.path.insert(0, str(Path(__file__).parent.parent))
