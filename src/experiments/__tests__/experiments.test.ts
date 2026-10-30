import { describe, it, expect } from 'vitest';
import { runSimulation } from '../../engine/simulator';
import {
  EXPERIMENTS,
  EXPERIMENT_A_CONFIG,
  EXPERIMENT_B_CONFIG,
  EXPERIMENT_C_CONFIG,
  type ExperimentRunState,
} from '../definitions';
import {
  escapeCsvCell,
  toCsvString,
  generateSummaryCsv,
  generateTimeSeriesCsv,
} from '../csvExport';

describe('Experiment Configuration Specifications', () => {
  it('Experiment A matches the baseline specifications exactly', () => {
    expect(EXPERIMENT_A_CONFIG.bottleneckBandwidthMbps).toBe(10);
    expect(EXPERIMENT_A_CONFIG.packetSizeBytes).toBe(1200);
    expect(EXPERIMENT_A_CONFIG.queueCapacity).toBe(100);
    expect(EXPERIMENT_A_CONFIG.propagationDelayMs).toBe(10);
    expect(EXPERIMENT_A_CONFIG.simulationDurationS).toBe(10);
    expect(EXPERIMENT_A_CONFIG.randomSeed).toBe(42);
    expect(EXPERIMENT_A_CONFIG.queuePolicy).toBe('drop-tail');

    const rates = EXPERIMENT_A_CONFIG.senders.map(s => s.rateMbps);
    expect(rates).toEqual([6, 5, 4]);
    const totalOffered = rates.reduce((a, b) => a + b, 0);
    expect(totalOffered).toBe(15);
  });

  it('Experiment B uses identical workload as A with 20 Mbps bottleneck capacity', () => {
    expect(EXPERIMENT_B_CONFIG.bottleneckBandwidthMbps).toBe(20);
    expect(EXPERIMENT_B_CONFIG.packetSizeBytes).toBe(EXPERIMENT_A_CONFIG.packetSizeBytes);
    expect(EXPERIMENT_B_CONFIG.queueCapacity).toBe(EXPERIMENT_A_CONFIG.queueCapacity);
    expect(EXPERIMENT_B_CONFIG.propagationDelayMs).toBe(EXPERIMENT_A_CONFIG.propagationDelayMs);
    expect(EXPERIMENT_B_CONFIG.simulationDurationS).toBe(EXPERIMENT_A_CONFIG.simulationDurationS);
    expect(EXPERIMENT_B_CONFIG.randomSeed).toBe(EXPERIMENT_A_CONFIG.randomSeed);
    expect(EXPERIMENT_B_CONFIG.trafficPattern).toBe(EXPERIMENT_A_CONFIG.trafficPattern);
    expect(EXPERIMENT_B_CONFIG.queuePolicy).toBe('drop-tail');

    expect(EXPERIMENT_B_CONFIG.senders.map(s => s.rateMbps)).toEqual(
      EXPERIMENT_A_CONFIG.senders.map(s => s.rateMbps)
    );
  });

  it('Experiment C uses identical workload and 10 Mbps bottleneck with strict priority for Host A', () => {
    expect(EXPERIMENT_C_CONFIG.bottleneckBandwidthMbps).toBe(10);
    expect(EXPERIMENT_C_CONFIG.queuePolicy).toBe('priority');
    expect(EXPERIMENT_C_CONFIG.simulationDurationS).toBe(EXPERIMENT_A_CONFIG.simulationDurationS);
    expect(EXPERIMENT_C_CONFIG.randomSeed).toBe(EXPERIMENT_A_CONFIG.randomSeed);

    const hostA = EXPERIMENT_C_CONFIG.senders.find(s => s.id === 'sender-a');
    const hostB = EXPERIMENT_C_CONFIG.senders.find(s => s.id === 'sender-b');
    const hostC = EXPERIMENT_C_CONFIG.senders.find(s => s.id === 'sender-c');

    expect(hostA?.priority).toBe('high');
    expect(hostB?.priority).toBe('normal');
    expect(hostC?.priority).toBe('normal');
  });
});

describe('Simulation Engine Output on Experiments', () => {
  it('reproduces deterministic identical outputs for the same configuration', () => {
    const run1 = runSimulation(EXPERIMENT_A_CONFIG);
    const run2 = runSimulation(EXPERIMENT_A_CONFIG);

    expect(run1.totalPacketsSent).toBe(run2.totalPacketsSent);
    expect(run1.totalPacketsDelivered).toBe(run2.totalPacketsDelivered);
    expect(run1.totalPacketsDropped).toBe(run2.totalPacketsDropped);
    expect(run1.deliveredThroughputMbps).toBe(run2.deliveredThroughputMbps);
    expect(run1.avgEndToEndDelayMs).toBe(run2.avgEndToEndDelayMs);
    expect(run1.peakQueueOccupancy).toBe(run2.peakQueueOccupancy);
  });

  it('Experiment B completely alleviates congestion compared to Experiment A', () => {
    const resA = runSimulation(EXPERIMENT_A_CONFIG);
    const resB = runSimulation(EXPERIMENT_B_CONFIG);

    // Exp A has severe packet loss and buffer saturation
    expect(resA.totalPacketsDropped).toBeGreaterThan(0);
    expect(resA.packetLossPercent).toBeGreaterThan(30);
    expect(resA.peakQueueOccupancy).toBe(100);
    expect(resA.deliveredThroughputMbps).toBeCloseTo(10, 0); // Bounded by 10 Mbps

    // Exp B has zero packet loss, low delay, full throughput delivery (15 Mbps)
    expect(resB.totalPacketsDropped).toBe(0);
    expect(resB.packetLossPercent).toBe(0);
    expect(resB.deliveredThroughputMbps).toBeGreaterThan(14.5); // Close to 15 Mbps offered load
    expect(resB.avgEndToEndDelayMs).toBeLessThan(resA.avgEndToEndDelayMs);
  });

  it('Experiment C strict-priority protects Host A from loss and queueing delay', () => {
    const resC = runSimulation(EXPERIMENT_C_CONFIG);

    const hostAStats = resC.senderStats.find(s => s.senderId === 'sender-a')!;
    const hostBStats = resC.senderStats.find(s => s.senderId === 'sender-b')!;
    const hostCStats = resC.senderStats.find(s => s.senderId === 'sender-c')!;

    // Host A (high priority, 6 Mbps < 10 Mbps link): 0 drops, minimal latency
    expect(hostAStats.packetsDropped).toBe(0);
    expect(hostAStats.packetsDelivered).toBe(hostAStats.packetsSent);
    // Delay should be near minimal propagation + tx delay (~11ms), well below average
    expect(hostAStats.avgDelayMs).toBeLessThan(15);

    // Host B and C absorb the congestion
    expect(hostBStats.packetsDropped).toBeGreaterThan(0);
    expect(hostCStats.packetsDropped).toBeGreaterThan(0);
    expect(hostBStats.avgDelayMs).toBeGreaterThan(50);
    expect(hostCStats.avgDelayMs).toBeGreaterThan(50);
  });
});

describe('CSV Serialization and Export', () => {
  it('correctly escapes values containing commas, quotes, and newlines', () => {
    expect(escapeCsvCell('simple')).toBe('simple');
    expect(escapeCsvCell('hello, world')).toBe('"hello, world"');
    expect(escapeCsvCell('He said "hello"')).toBe('"He said ""hello"""');
    expect(escapeCsvCell("line1\nline2")).toBe("\"line1\nline2\"");
    expect(escapeCsvCell(12.34)).toBe('12.34');
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
  });

  it('builds formatted CSV rows via toCsvString', () => {
    const rows = [
      ['Col1', 'Col2', 'Col3'],
      ['Val,1', 'Val "2"', 100],
    ];
    const csv = toCsvString(rows);
    expect(csv).toBe('Col1,Col2,Col3\r\n"Val,1","Val ""2""",100');
  });

  it('omits unrun or failed experiments from the summary CSV', () => {
    const resA = runSimulation(EXPERIMENT_A_CONFIG);
    const mockRuns: Record<string, ExperimentRunState> = {
      'exp-a': { status: 'completed', result: resA },
      'exp-b': { status: 'idle', result: null },
      'exp-c': { status: 'failed', result: null, error: 'Simulated failure' },
    };

    const csv = generateSummaryCsv(EXPERIMENTS, mockRuns);
    const lines = csv.split('\r\n');

    // Header + Exp A only
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain('Experiment A');
    expect(lines[1]).not.toContain('Experiment B');
    expect(lines[1]).not.toContain('Experiment C');
    expect(lines[1]).toContain('Completed');
  });

  it('generates complete summary CSV with all metrics when all runs are completed', () => {
    const resA = runSimulation(EXPERIMENT_A_CONFIG);
    const resB = runSimulation(EXPERIMENT_B_CONFIG);
    const resC = runSimulation(EXPERIMENT_C_CONFIG);

    const mockRuns: Record<string, ExperimentRunState> = {
      'exp-a': { status: 'completed', result: resA },
      'exp-b': { status: 'completed', result: resB },
      'exp-c': { status: 'completed', result: resC },
    };

    const csv = generateSummaryCsv(EXPERIMENTS, mockRuns);
    const lines = csv.split('\r\n');

    expect(lines.length).toBe(4); // Header + 3 experiment rows
    expect(lines[0]).toContain('Delivered Throughput (Mbps)');
    expect(lines[0]).toContain('Link Utilization (%)');
    expect(lines[1]).toContain('Baseline Congestion');
    expect(lines[2]).toContain('Increased Bandwidth');
    expect(lines[3]).toContain('Strict Priority');
  });

  it('generates time-series CSV with sample rows', () => {
    const resA = runSimulation(EXPERIMENT_A_CONFIG);
    const mockRuns: Record<string, ExperimentRunState> = {
      'exp-a': { status: 'completed', result: resA },
    };

    const csv = generateTimeSeriesCsv(EXPERIMENTS, mockRuns);
    const lines = csv.split('\r\n');

    expect(lines.length).toBeGreaterThan(10);
    expect(lines[0]).toBe('Time (s),Experiment,Throughput (Mbps),Queue Length (pkts),Average Delay (ms),Packets Dropped in Window,Offered Load (Mbps)');
  });
});
