"""Profile-driven contract tests. GATE_PROFILE=baseline|target (default target)."""
import os, unittest
import policy_gate as g

PROFILE = os.environ.get("GATE_PROFILE", "target")


class TestGateContract(unittest.TestCase):
    def test_profile_values(self):
        if PROFILE == "baseline":
            self.assertEqual((g.MAX_RETRY, g.BACKOFF_BASE_MS, g.BACKOFF_CAP_MS), (3, 200, 800))
            self.assertFalse(g.JITTER)
        else:
            self.assertEqual((g.MAX_RETRY, g.BACKOFF_BASE_MS, g.BACKOFF_CAP_MS), (5, 200, 3200))
            self.assertTrue(g.JITTER)

    def test_retry_budget(self):
        last = g.MAX_RETRY - 1
        self.assertTrue(g.should_retry(last))
        self.assertFalse(g.should_retry(g.MAX_RETRY))

    def test_backoff_is_capped_monotonic(self):
        seq = [g.backoff_ms(i) for i in range(0, 8)]
        self.assertEqual(seq, sorted(seq))
        self.assertLessEqual(max(seq), g.BACKOFF_CAP_MS)

    def test_target_only_dynamic_jitter(self):
        if PROFILE != "target":
            self.skipTest("baseline: static backoff only")
        vals = {g.backoff_ms(0) for _ in range(50)}
        self.assertGreater(len(vals), 1)
