import { describe, it, expect } from 'vitest';
import { runSimulation } from '../simulator';
import { SeededRandom } from '../SeededRandom';
import type { SimulationConfig } from '../types';

const BASE_CONFIG: SimulationConfig = {
  senders: [
    { id: 'sender-a', label: 'Host A', rateMbps: 6, color: '#38BDF8' },
    { id: 'sender-b', label: 'Host B', rateMbps: 5, color: '#06B6D4' },
    { id: 'sender-c', label: 'Host C', rateMbps: 4, color: '#4edea3' },
  ],
  bottleneckBandwidthMbps: 10,
  packetSizeBytes: 1200,
  propagationDelayMs: 10,
  queueCapacity: 100,
  simulationDurationS: 2,
  randomSeed: 42,
  trafficPattern: 'constant',
  queuePolicy: 'drop-tail',
};

describe('SeededRandom PRNG', () => {
  it('generates deterministic pseudorandom sequences for the same seed', () => {
    const rng1 = new SeededRandom(12345);
    const rng2 = new SeededRandom(12345);
    const seq1 = Array.from({ length: 10 }, () => rng1.next());
    const seq2 = Array.from({ length: 10 }, () => rng2.next());
    expect(seq1).toEqual(seq2);
  });

  it('generates different sequences for different seeds', () => {
    const rng1 = new SeededRandom(1);
    const rng2 = new SeededRandom(2);
    expect(rng1.next()).not.toEqual(rng2.next());
  });

  it('generates integers within specified bounds', () => {
    const rng = new SeededRandom(999);
    for (let i = 0; i < 100; i++) {
      const val = rng.nextInt(5, 15);
      expect(val).toBeGreaterThanOrEqual(5);
      expect(val).toBeLessThanOrEqual(15);
      expect(Number.isInteger(val)).toBe(true);
    }
  });

  it('generates positive exponential values', () => {
    const rng = new SeededRandom(42);
    for (let i = 0; i < 50; i++) {
      const expVal = rng.nextExponential(10);
      expect(expVal).toBeGreaterThan(0);
    }
  });
});

describe('NetPulse Simulation Engine', () => {
  describe('Packet generation and transmission under capacity (No congestion)', () => {
    it('transmits all packets without drops when offered load is well below bottleneck capacity', () => {
      const config: SimulationConfig = {
        ...BASE_CONFIG,
        senders: [
          { id: 'sender-a', label: 'Host A', rateMbps: 2, color: '#38BDF8' },
          { id: 'sender-b', label: 'Host B', rateMbps: 2, color: '#06B6D4' },
        ],
        bottleneckBandwidthMbps: 10, // 4 Mbps offered vs 10 Mbps bottleneck
        simulationDurationS: 1,
      };

      const result = runSimulation(config);

      expect(result.totalPacketsSent).toBeGreaterThan(0);
      expect(result.totalPacketsDropped).toBe(0);
      expect(result.packetLossPercent).toBe(0);
      expect(result.totalPacketsDelivered).toBe(result.totalPacketsSent);
      expect(result.congestionDetected).toBe(false);
      expect(result.bufferSaturated).toBe(false);
      // Delivered throughput should closely match offered load (4 Mbps)
      expect(result.deliveredThroughputMbps).toBeGreaterThan(3.5);
      expect(result.deliveredThroughputMbps).toBeLessThanOrEqual(4.5);
    });
  });

  describe('Bottleneck capacity and Drop-Tail drops (Congestion)', () => {
    it('drops packets via Drop-Tail and throttles throughput to bottleneck capacity when overloaded', () => {
      const config: SimulationConfig = {
        ...BASE_CONFIG,
        senders: [
          { id: 'sender-a', label: 'Host A', rateMbps: 10, color: '#38BDF8' },
          { id: 'sender-b', label: 'Host B', rateMbps: 10, color: '#06B6D4' },
        ],
        bottleneckBandwidthMbps: 5, // 20 Mbps offered vs 5 Mbps bottleneck
        queueCapacity: 20, // small queue
        simulationDurationS: 2,
      };

      const result = runSimulation(config);

      expect(result.totalPacketsSent).toBeGreaterThan(0);
      expect(result.totalPacketsDropped).toBeGreaterThan(0);
      expect(result.packetLossPercent).toBeGreaterThan(50);
      expect(result.congestionDetected).toBe(true);
      expect(result.bufferSaturated).toBe(true);
      expect(result.bufferSaturationTimeMs).not.toBeNull();
      expect(result.peakQueueOccupancy).toBe(config.queueCapacity);

      // Delivered throughput should be bounded near bottleneck capacity (5 Mbps)
      expect(result.deliveredThroughputMbps).toBeGreaterThan(4.5);
      expect(result.deliveredThroughputMbps).toBeLessThan(5.5);
    });

    it('records packet_dropped events with queue length metadata', () => {
      const config: SimulationConfig = {
        ...BASE_CONFIG,
        senders: [{ id: 's1', label: 'Host 1', rateMbps: 20, color: '#fff' }],
        bottleneckBandwidthMbps: 5,
        queueCapacity: 10,
        simulationDurationS: 1,
      };

      const result = runSimulation(config);
      const dropEvents = result.events.filter(e => e.type === 'packet_dropped');

      expect(dropEvents.length).toBeGreaterThan(0);
      for (const drop of dropEvents) {
        expect(drop.metadata?.queueLength).toBe(config.queueCapacity);
      }
    });
  });

  describe('Propagation and Queueing Delay', () => {
    it('end-to-end delay includes propagation delay and transmission delay', () => {
      const propDelay = 25; // 25ms
      const packetBytes = 1000;
      const bwMbps = 8; // 8 Mbps -> 1000 * 8 / 8,000,000 = 1ms transmission delay
      const config: SimulationConfig = {
        ...BASE_CONFIG,
        senders: [{ id: 's1', label: 'Host 1', rateMbps: 1, color: '#fff' }],
        bottleneckBandwidthMbps: bwMbps,
        packetSizeBytes: packetBytes,
        propagationDelayMs: propDelay,
        simulationDurationS: 1,
      };

      const result = runSimulation(config);
      expect(result.totalPacketsDelivered).toBeGreaterThan(0);

      // Expected minimum delay per packet = 1ms (tx) + 25ms (prop) = 26ms
      const minExpectedDelay = (packetBytes * 8 / (bwMbps * 1_000_000)) * 1000 + propDelay;
      for (const pkt of result.packets.filter(p => !p.dropped)) {
        const delay = pkt.deliveredAt! - pkt.generatedAt;
        expect(delay).toBeGreaterThanOrEqual(minExpectedDelay - 0.001);
      }
      expect(result.avgEndToEndDelayMs).toBeGreaterThanOrEqual(minExpectedDelay - 0.001);
    });

    it('experiences increased queueing delay when queue builds up', () => {
      const configLowLoad: SimulationConfig = {
        ...BASE_CONFIG,
        senders: [{ id: 's1', label: 'Host 1', rateMbps: 2, color: '#fff' }],
        bottleneckBandwidthMbps: 10,
        simulationDurationS: 1,
      };

      const configHighLoad: SimulationConfig = {
        ...BASE_CONFIG,
        senders: [{ id: 's1', label: 'Host 1', rateMbps: 12, color: '#fff' }],
        bottleneckBandwidthMbps: 10,
        queueCapacity: 50,
        simulationDurationS: 1,
      };

      const resLow = runSimulation(configLowLoad);
      const resHigh = runSimulation(configHighLoad);

      expect(resHigh.avgEndToEndDelayMs).toBeGreaterThan(resLow.avgEndToEndDelayMs);
    });
  });

  describe('Bufferless link (queueCapacity = 0)', () => {
    it('transmits when link is idle and drops whenever link is busy', () => {
      const config: SimulationConfig = {
        ...BASE_CONFIG,
        senders: [
          { id: 's1', label: 'Host 1', rateMbps: 10, color: '#fff' },
          { id: 's2', label: 'Host 2', rateMbps: 10, color: '#fff' },
        ],
        bottleneckBandwidthMbps: 10,
        queueCapacity: 0, // bufferless
        simulationDurationS: 1,
      };

      const result = runSimulation(config);
      expect(result.totalPacketsDelivered).toBeGreaterThan(0);
      expect(result.totalPacketsDropped).toBeGreaterThan(0);
      expect(result.peakQueueOccupancy).toBe(0);
      expect(result.bufferSaturated).toBe(true);
    });
  });

  describe('Bursty Traffic Pattern', () => {
    it('produces reproducible results with the same random seed', () => {
      const burstyConfig: SimulationConfig = {
        ...BASE_CONFIG,
        trafficPattern: 'bursty',
        randomSeed: 9876,
        simulationDurationS: 1,
      };

      const run1 = runSimulation(burstyConfig);
      const run2 = runSimulation(burstyConfig);

      expect(run1.totalPacketsSent).toBe(run2.totalPacketsSent);
      expect(run1.totalPacketsDelivered).toBe(run2.totalPacketsDelivered);
      expect(run1.totalPacketsDropped).toBe(run2.totalPacketsDropped);
      expect(run1.deliveredThroughputMbps).toBe(run2.deliveredThroughputMbps);
      expect(run1.avgEndToEndDelayMs).toBe(run2.avgEndToEndDelayMs);
    });

    it('produces different traffic traces with different seeds', () => {
      const configA: SimulationConfig = { ...BASE_CONFIG, trafficPattern: 'bursty', randomSeed: 100, simulationDurationS: 1 };
      const configB: SimulationConfig = { ...BASE_CONFIG, trafficPattern: 'bursty', randomSeed: 200, simulationDurationS: 1 };

      const runA = runSimulation(configA);
      const runB = runSimulation(configB);

      // Event packet arrival times or sent packet counts should differ
      expect(runA.packets.map(p => p.generatedAt)).not.toEqual(runB.packets.map(p => p.generatedAt));
    });
  });

  describe('Empty traffic and invalid configurations', () => {
    it('handles empty sender list gracefully', () => {
      const config: SimulationConfig = {
        ...BASE_CONFIG,
        senders: [],
      };

      const result = runSimulation(config);
      expect(result.totalPacketsSent).toBe(0);
      expect(result.totalPacketsDelivered).toBe(0);
      expect(result.totalPacketsDropped).toBe(0);
      expect(result.deliveredThroughputMbps).toBe(0);
      expect(result.avgEndToEndDelayMs).toBe(0);
      expect(result.packetLossPercent).toBe(0);
      expect(result.congestionDetected).toBe(false);
    });

    it('handles senders with zero or negative rate without infinite loop', () => {
      const config: SimulationConfig = {
        ...BASE_CONFIG,
        senders: [
          { id: 's1', label: 'Host 1', rateMbps: 0, color: '#fff' },
          { id: 's2', label: 'Host 2', rateMbps: -5, color: '#fff' },
        ],
        simulationDurationS: 1,
      };

      const result = runSimulation(config);
      expect(result.totalPacketsSent).toBe(0);
      expect(result.totalPacketsDelivered).toBe(0);
      expect(result.deliveredThroughputMbps).toBe(0);
    });

    it('handles zero or negative duration gracefully', () => {
      const configZero: SimulationConfig = {
        ...BASE_CONFIG,
        simulationDurationS: 0,
      };
      const configNeg: SimulationConfig = {
        ...BASE_CONFIG,
        simulationDurationS: -1,
      };

      expect(runSimulation(configZero).totalPacketsSent).toBe(0);
      expect(runSimulation(configNeg).totalPacketsSent).toBe(0);
    });

    it('handles invalid bottleneck bandwidth gracefully', () => {
      const configZeroBw: SimulationConfig = {
        ...BASE_CONFIG,
        bottleneckBandwidthMbps: 0,
      };
      const configNegBw: SimulationConfig = {
        ...BASE_CONFIG,
        bottleneckBandwidthMbps: -10,
      };

      expect(runSimulation(configZeroBw).totalPacketsSent).toBe(0);
      expect(runSimulation(configNegBw).totalPacketsSent).toBe(0);
    });
  });

  describe('Time-series and sender statistics consistency', () => {
    it('maintains sum of sender packets equal to total packets', () => {
      const result = runSimulation(BASE_CONFIG);

      const sumSent = result.senderStats.reduce((sum, s) => sum + s.packetsSent, 0);
      const sumDelivered = result.senderStats.reduce((sum, s) => sum + s.packetsDelivered, 0);
      const sumDropped = result.senderStats.reduce((sum, s) => sum + s.packetsDropped, 0);

      expect(sumSent).toBe(result.totalPacketsSent);
      expect(sumDelivered).toBe(result.totalPacketsDelivered);
      expect(sumDropped).toBe(result.totalPacketsDropped);
    });

    it('generates non-empty timeSeries samples spanning the measurement interval', () => {
      const result = runSimulation(BASE_CONFIG);
      expect(result.timeSeries.length).toBeGreaterThan(0);
      expect(result.timeSeries[0].time).toBe(0);
    });

    it('handles a high-rate browser scenario without quadratic metric sampling', () => {
      const config: SimulationConfig = {
        ...BASE_CONFIG,
        senders: [
          { id: 'sender-a', label: 'Host A', rateMbps: 60.9, color: '#38BDF8' },
          { id: 'sender-b', label: 'Host B', rateMbps: 50.7, color: '#06B6D4' },
          { id: 'sender-c', label: 'Host C', rateMbps: 64.1, color: '#4edea3' },
        ],
        bottleneckBandwidthMbps: 10,
        packetSizeBytes: 1200,
        queueCapacity: 100,
        simulationDurationS: 10,
      };

      const result = runSimulation(config);
      const sampledDrops = result.timeSeries.reduce((sum, sample) => sum + sample.droppedInWindow, 0);

      expect(result.totalPacketsSent).toBeGreaterThan(180_000);
      expect(sampledDrops).toBe(result.totalPacketsDropped);
      expect(result.timeSeries.every(sample =>
        Number.isFinite(sample.throughputMbps) &&
        Number.isFinite(sample.avgDelayMs) &&
        Number.isFinite(sample.queueLength) &&
        sample.queueLength >= 0
      )).toBe(true);
    });
  });
});
