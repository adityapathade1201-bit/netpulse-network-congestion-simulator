import type { SimulationConfig } from '../engine/types';

export const DEFAULT_CONFIG: SimulationConfig = {
  senders: [
    { id: 'sender-a', label: 'Host A', rateMbps: 6, color: '#38BDF8' },
    { id: 'sender-b', label: 'Host B', rateMbps: 5, color: '#06B6D4' },
    { id: 'sender-c', label: 'Host C', rateMbps: 4, color: '#4edea3' },
  ],
  bottleneckBandwidthMbps: 10,
  packetSizeBytes: 1200,
  propagationDelayMs: 10,
  queueCapacity: 100,
  simulationDurationS: 10,
  randomSeed: 42,
  trafficPattern: 'constant',
  queuePolicy: 'drop-tail',
};

/** Input validation ranges */
export const LIMITS = {
  senderRate: { min: 0, max: 100 },
  bottleneckBw: { min: 0.1, max: 1000 },
  packetSize: { min: 64, max: 9000 },
  propagationDelay: { min: 0, max: 500 },
  queueCapacity: { min: 1, max: 10000 },
  simDuration: { min: 1, max: 60 },
  seed: { min: 0, max: 2147483647 },
} as const;
