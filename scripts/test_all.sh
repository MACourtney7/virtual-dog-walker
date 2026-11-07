#!/bin/sh
# Convenience wrapper around the project's Python test runner.
set -e
cd "$(dirname "$0")/.."
exec python3 test/run_tests.py
