# Simulation workload guard fix

## What changed

- Replaced repeated per-window packet-list filtering with a sorted, cursor-based linear-time sweep in both the normal simulator and the educational adaptive-feedback simulator.
- Replaced repeated per-sender packet filtering with one-pass sender aggregation.
- Changed the browser safety guard to estimate packet count directly and warn only above 250,000 estimated packets per run.
- Added regression coverage for the high-rate configuration shown in the reported screenshot and for feedback-mode time-series drop accounting.

## Screenshot scenario

The rates 60.9 + 50.7 + 64.1 Mbps, 1,200-byte packets and 10 seconds generate about 183,021 packets by the configuration estimate. That is below the 250,000-packet safety limit, so the previous "too expensive" warning no longer blocks the run.

A runtime check processed 183,022 packets in about 0.3 seconds in the validation environment. Actual speed will vary by device/browser.

## Limits

Extremely large runs are still restricted to protect the browser tab. The simulation is a simplified educational model, not full TCP/IP emulation or live network monitoring.
