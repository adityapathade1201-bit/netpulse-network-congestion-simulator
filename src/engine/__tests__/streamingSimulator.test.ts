import { describe, expect, it } from 'vitest';
import { runSimulation } from '../simulator';
import type { SimulationConfig } from '../types';

describe('high-rate streaming simulation', () => {
  const highRateConfig: SimulationConfig = {
    senders: Array.from({ length: 20 }, (_, i) => ({
      id: `sender-${i + 1}`,
      label: `Host ${i + 1}`,
      rateMbps: [53.9, 60.4, 77.5, 100, 95.6, 99.7, 99.3, 97.4, 97.9, 91.9, 94.2, 98.8, 97.9, 97, 1, 1, 1, 1, 1, 1][i],
      color: `hsl(${i * 18}, 75%, 55%)`,
      priority: i === 0 ? 'high' : 'normal',
    })),
    bottleneckBandwidthMbps: 10,
    packetSizeBytes: 1200,
    propagationDelayMs: 10,
    queueCapacity: 100,
    simulationDurationS: 10,
    randomSeed: 42,
    trafficPattern: 'constant',
    queuePolicy: 'drop-tail',
    automaticCongestionControl: false,
  };

  it('processes million-packet traffic without retaining every packet event', () => {
    const result = runSimulation(highRateConfig);

    expect(result.totalPacketsSent).toBeGreaterThan(1_000_000);
    expect(result.totalPacketsDelivered + result.totalPacketsDropped).toBe(result.totalPacketsSent);
    expect(result.visualTraceSampled).toBe(true);
    expect(result.simulationMode).toBe('streamed-packet-level');
    expect(result.visualTraceStride).toBeGreaterThan(1);
    expect(result.packets.length).toBeLessThan(5_000);
    expect(result.events.length).toBeLessThan(50_000);
    expect(result.senderStats.reduce((sum, sender) => sum + sender.packetsSent, 0)).toBe(result.totalPacketsSent);
    expect(result.senderStats.reduce((sum, sender) => sum + sender.packetsDelivered, 0)).toBe(result.totalPacketsDelivered);
    expect(result.senderStats.reduce((sum, sender) => sum + sender.packetsDropped, 0)).toBe(result.totalPacketsDropped);
    expect(result.deliveredThroughputMbps).toBeLessThanOrEqual(10.01);
    expect(result.packetLossPercent).toBeGreaterThan(90);
    expect(result.timeSeries.length).toBeGreaterThan(90);
  });

  it('is deterministic for the same high-rate configuration and seed', () => {
    const a = runSimulation({ ...highRateConfig, simulationDurationS: 2 });
    const b = runSimulation({ ...highRateConfig, simulationDurationS: 2 });
    expect(a.totalPacketsSent).toBe(b.totalPacketsSent);
    expect(a.totalPacketsDelivered).toBe(b.totalPacketsDelivered);
    expect(a.totalPacketsDropped).toBe(b.totalPacketsDropped);
    expect(a.avgEndToEndDelayMs).toBe(b.avgEndToEndDelayMs);
    expect(a.timeSeries).toEqual(b.timeSeries);
  });
});
