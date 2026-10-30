import type { SimulationConfig, SimulationResults } from '../engine/types';

export interface ExperimentDefinition {
  id: 'exp-a' | 'exp-b' | 'exp-c';
  key: 'A' | 'B' | 'C';
  title: string;
  subtitle: string;
  badge: string;
  badgeColor: string;
  config: SimulationConfig;
  description: string;
}

export type ExperimentStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface ExperimentRunState {
  status: ExperimentStatus;
  result: SimulationResults | null;
  error?: string;
  runDurationMs?: number;
}

const COMMON_SENDERS = [
  { id: 'sender-a', label: 'Host A', rateMbps: 6, color: '#38BDF8' },
  { id: 'sender-b', label: 'Host B', rateMbps: 5, color: '#06B6D4' },
  { id: 'sender-c', label: 'Host C', rateMbps: 4, color: '#4edea3' },
];

/** Experiment A: Baseline Congestion (10 Mbps bottleneck, 15 Mbps offered, Drop-Tail) */
export const EXPERIMENT_A_CONFIG: SimulationConfig = {
  senders: [
    { ...COMMON_SENDERS[0], priority: 'normal' },
    { ...COMMON_SENDERS[1], priority: 'normal' },
    { ...COMMON_SENDERS[2], priority: 'normal' },
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

/** Experiment B: Increased Bandwidth (20 Mbps bottleneck, 15 Mbps offered, Drop-Tail) */
export const EXPERIMENT_B_CONFIG: SimulationConfig = {
  senders: [
    { ...COMMON_SENDERS[0], priority: 'normal' },
    { ...COMMON_SENDERS[1], priority: 'normal' },
    { ...COMMON_SENDERS[2], priority: 'normal' },
  ],
  bottleneckBandwidthMbps: 20,
  packetSizeBytes: 1200,
  propagationDelayMs: 10,
  queueCapacity: 100,
  simulationDurationS: 10,
  randomSeed: 42,
  trafficPattern: 'constant',
  queuePolicy: 'drop-tail',
};

/** Experiment C: Strict-Priority Queue Policy (10 Mbps bottleneck, Host A high priority) */
export const EXPERIMENT_C_CONFIG: SimulationConfig = {
  senders: [
    { ...COMMON_SENDERS[0], priority: 'high' },
    { ...COMMON_SENDERS[1], priority: 'normal' },
    { ...COMMON_SENDERS[2], priority: 'normal' },
  ],
  bottleneckBandwidthMbps: 10,
  packetSizeBytes: 1200,
  propagationDelayMs: 10,
  queueCapacity: 100,
  simulationDurationS: 10,
  randomSeed: 42,
  trafficPattern: 'constant',
  queuePolicy: 'priority',
};

export const EXPERIMENTS: ExperimentDefinition[] = [
  {
    id: 'exp-a',
    key: 'A',
    title: 'Baseline Congestion',
    subtitle: 'Standard 10 Mbps Drop-Tail Link',
    badge: 'Baseline',
    badgeColor: '#93CCFF',
    config: EXPERIMENT_A_CONFIG,
    description: '15 Mbps offered load exceeds the 10 Mbps bottleneck, driving buffer exhaustion and sustained Drop-Tail packet loss.',
  },
  {
    id: 'exp-b',
    key: 'B',
    title: 'Increased Bandwidth',
    subtitle: '20 Mbps Bottleneck (+100% Capacity)',
    badge: '+100% Bandwidth',
    badgeColor: '#4CD7F6',
    config: EXPERIMENT_B_CONFIG,
    description: 'Doubling link capacity to 20 Mbps absorbs all 15 Mbps offered traffic, eliminating bufferbloat and packet drops.',
  },
  {
    id: 'exp-c',
    key: 'C',
    title: 'Queue Policy Comparison',
    subtitle: 'Strict Priority (Host A High Priority)',
    badge: 'Strict Priority',
    badgeColor: '#3198DC',
    config: EXPERIMENT_C_CONFIG,
    description: 'Prioritizes Host A traffic over normal traffic, protecting interactive packets at the expense of non-priority flows under identical 10 Mbps capacity.',
  },
];
