import { describe, expect, it } from 'vitest';
import { runSimulation } from '../simulator';
import { DEFAULT_CONFIG } from '../../config/defaults';

describe('rule-based automatic congestion feedback', () => {
  it('records feedback adjustments for an overloaded network', () => {
    const result = runSimulation({
      ...DEFAULT_CONFIG,
      automaticCongestionControl: true,
    });

    const adjustments = result.events.filter(event => event.type === 'control_adjustment');
    expect(adjustments.length).toBeGreaterThan(0);
    expect(adjustments.every(event => Number(event.metadata?.rateScale) >= 0.15)).toBe(true);
    expect(result.totalPacketsSent).toBeGreaterThan(0);
    expect(result.timeSeries.length).toBeGreaterThan(0);
  });


  it('reduces packet drops versus the same overloaded open-loop scenario', () => {
    const openLoop = runSimulation({ ...DEFAULT_CONFIG, automaticCongestionControl: false });
    const controlled = runSimulation({ ...DEFAULT_CONFIG, automaticCongestionControl: true });
    expect(openLoop.totalPacketsDropped).toBeGreaterThan(0);
    expect(controlled.totalPacketsDropped).toBeLessThan(openLoop.totalPacketsDropped);
    expect(controlled.totalPacketsSent).toBeLessThan(openLoop.totalPacketsSent);
  });

  it('is deterministic for an identical configuration and seed', () => {
    const config = { ...DEFAULT_CONFIG, automaticCongestionControl: true, randomSeed: 99 };
    const first = runSimulation(config);
    const second = runSimulation(config);

    expect(first.totalPacketsSent).toBe(second.totalPacketsSent);
    expect(first.totalPacketsDropped).toBe(second.totalPacketsDropped);
    expect(first.deliveredThroughputMbps).toBe(second.deliveredThroughputMbps);
    expect(first.events.filter(e => e.type === 'control_adjustment')).toEqual(
      second.events.filter(e => e.type === 'control_adjustment'),
    );
  });

  it('does not throttle a low-load network when no congestion is observed', () => {
    const config = {
      ...DEFAULT_CONFIG,
      senders: [{ ...DEFAULT_CONFIG.senders[0], rateMbps: 1 }],
      bottleneckBandwidthMbps: 10,
      automaticCongestionControl: true,
    };
    const result = runSimulation(config);

    expect(result.totalPacketsDropped).toBe(0);
    expect(result.events.filter(event => event.type === 'control_adjustment')).toHaveLength(0);
    expect(result.packetLossPercent).toBe(0);
  });

  it('keeps generated, delivered, and dropped packet counts consistent', () => {
    const result = runSimulation({ ...DEFAULT_CONFIG, automaticCongestionControl: true });
    expect(result.totalPacketsDelivered + result.totalPacketsDropped).toBe(result.totalPacketsSent);
    expect(result.packetLossPercent).toBeCloseTo(
      result.totalPacketsSent > 0 ? (result.totalPacketsDropped / result.totalPacketsSent) * 100 : 0,
      6,
    );
    expect(result.deliveredThroughputMbps).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.avgEndToEndDelayMs)).toBe(true);
  });


  it('time-series sampling accounts for all drops when feedback control is enabled', () => {
    const result = runSimulation({ ...DEFAULT_CONFIG, automaticCongestionControl: true });
    const sampledDrops = result.timeSeries.reduce((sum, sample) => sum + sample.droppedInWindow, 0);
    expect(sampledDrops).toBe(result.totalPacketsDropped);
    expect(result.timeSeries.every(sample =>
      Number.isFinite(sample.throughputMbps) && Number.isFinite(sample.avgDelayMs) && sample.queueLength >= 0
    )).toBe(true);
  });
});
