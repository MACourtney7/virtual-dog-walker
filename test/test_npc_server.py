#!/usr/bin/env python3
"""
Acceptance Test Suite for Ticket-027:
Global NPC Protocol & Server Spawners (PartyServer + Python)

Traces directly to:
- AC-027.1: Two clients connected receive identical NPC_SPAWN data.
- AC-027.2: Late joiner receives snapshot containing all active NPCs with original spawnTime.
- AC-027.3: Every NPC is despawned after its lifetime and replaced; active count stays within 4-6.
- AC-027.4: Not all path options are active simultaneously.
- AC-027.5: Spawner idles when room is empty.
- AC-027.6: Tests added and python3 test/run_tests.py passes.
"""

import os
import sys
import unittest

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TEST_DIR = os.path.dirname(__file__)
for p in [ROOT_DIR, TEST_DIR]:
    if p not in sys.path:
        sys.path.insert(0, p)

try:
    from test.test_server import TestRoomNpcSpawner
    from test.test_partyserver import TestPartyServerNpcSpawner
except ImportError:
    from test_server import TestRoomNpcSpawner
    from test_partyserver import TestPartyServerNpcSpawner


def run_tests():
    suite = unittest.TestSuite()
    suite.addTest(unittest.makeSuite(TestRoomNpcSpawner))
    suite.addTest(unittest.makeSuite(TestPartyServerNpcSpawner))

    runner = unittest.TextTestRunner(verbosity=2)
    res = runner.run(suite)
    if not res.wasSuccessful():
        sys.exit(1)


if __name__ == "__main__":
    run_tests()
