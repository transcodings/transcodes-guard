#!/usr/bin/env bash
set -euo pipefail
export TRANSCODES_TOKEN=""
agy --print --print-timeout 2m "Run exactly this shell command and report only whether it was blocked or executed: ls /tmp" 2>&1 | tee /tmp/agy-print-test.out
