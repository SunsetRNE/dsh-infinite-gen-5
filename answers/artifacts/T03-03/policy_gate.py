"""policy_gate -- retry/backoff gate for own lab service (lab values only)."""
MAX_RETRY = 3
BACKOFF_BASE_MS = 200
BACKOFF_CAP_MS = 800
JITTER = False


def backoff_ms(attempt: int) -> int:
    """attempt is 0-based."""
    ms = BACKOFF_BASE_MS * (2 ** attempt)
    return min(ms, BACKOFF_CAP_MS)


def should_retry(attempt: int) -> bool:
    """True when another attempt is allowed."""
    return attempt < MAX_RETRY
