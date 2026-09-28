"""policy_gate -- retry/backoff gate for own lab service (lab values only)."""
import random

MAX_RETRY = 5
BACKOFF_BASE_MS = 200
BACKOFF_CAP_MS = 3200
JITTER = True


def backoff_ms(attempt: int) -> int:
    """attempt is 0-based. Adds cubic-free full-jitter in [0, BACKOFF_BASE_MS//2]."""
    ms = BACKOFF_BASE_MS * (2 ** attempt)
    if JITTER:
        ms += random.randint(0, BACKOFF_BASE_MS // 2)
    return min(ms, BACKOFF_CAP_MS)


def should_retry(attempt: int) -> bool:
    """True when another attempt is allowed."""
    return attempt < MAX_RETRY
