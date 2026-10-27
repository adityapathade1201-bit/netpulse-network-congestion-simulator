/**
 * NetPulse Discrete-Event Simulation Engine
 *
 * ## Architecture
 * This is a packet-level discrete-event simulator. It works in three phases:
 *   1. **Traffic Generation**: Create all packet arrival events based on sender rates.
 *   2. **Event Processing**: Process events in chronological order through a priority queue.
 *   3. **Metric Collection**: Sample time-series data and compute final statistics.
 *
 * ## Simultaneous Event Ordering
 * When multiple events have the same timestamp:
 *   - `tx_complete` (departures) are processed BEFORE `packet_arrived` (arrivals).
 *     This models the physical reality that a departure frees a queue slot before
 *     a simultaneous arrival tries to claim one.
 *   - Among arrivals at the same time, they are processed in generation order (packet ID).
 *
 * ## Queue Scheduling Policies
 * - `drop-tail`: Standard single FIFO queue with capacity `queueCapacity`. Arriving packets
 *   are transmitted in strict FIFO arrival order. When the waiting queue length equals
 *   `queueCapacity`, arriving packets are dropped.
 * - `priority`: Strict-priority queuing (PQ) modeling multi-band priority scheduling
 *   (e.g., Linux prio qdisc / Cisco PQ). Packets marked with `priority: 'high'` are queued
 *   into a dedicated high-priority queue (capacity `queueCapacity`); normal packets enter
 *   the normal-priority queue (capacity `queueCapacity`). Whenever the bottleneck link becomes
 *   free, the scheduler always serves the high-priority queue first before the normal-priority
 *   queue. Within each priority class, FIFO order is strictly preserved. If a class queue reaches
 *   `queueCapacity`, arriving packets for that class are dropped via Drop-Tail.
 *
 * ## Queue Capacity
 * `queueCapacity` is the max number of packets WAITING in the queue.
 * The packet currently being transmitted on the link is NOT counted against this capacity.
 *
 * ## After Traffic Generation Ends
 * When the traffic generation duration expires, no new packets are created.
 * However, packets already in the queue continue to be transmitted and delivered.
 * The measurement interval extends until the last packet is delivered or the queue
 * is drained, whichever comes last.
 */

import type {
  SimulationConfig,
  SimEvent,
  Packet,
  MetricSample,
  SenderStats,
  SimulationResults,
} from './types';
import { SeededRandom } from './SeededRandom';

// Event priority for tie-breaking simultaneous events
const EVENT_PRIORITY: Record<string, number> = {
  tx_complete: 0,      // Departures first (free queue slots)
  packet_delivered: 1,
  tx_start: 2,
  packet_enqueued: 3,
  packet_arrived: 4,   // Arrivals after departures
  packet_generated: 5,
  packet_dropped: 6,
};

interface InternalEvent {
  time: number;
  type: string;
  packetId: number;
  senderId: string;
  priority: number;
}

export function runSimulation(config: SimulationConfig): SimulationResults {
  const {
    senders,
    bottleneckBandwidthMbps,
    packetSizeBytes,
    propagationDelayMs,
    queueCapacity,
    simulationDurationS,
    randomSeed,
    trafficPattern,
    queuePolicy = 'drop-tail',
  } = config;

  const validSenders = senders ?? [];
  const offeredLoadMbps = validSenders.reduce(
    (sum, s) => sum + (s.rateMbps > 0 ? s.rateMbps : 0),
    0
  );

  // Guard against invalid or empty configurations
  if (
    simulationDurationS <= 0 ||
    bottleneckBandwidthMbps <= 0 ||
    packetSizeBytes <= 0 ||
    queueCapacity < 0 ||
    validSenders.length === 0
  ) {
    const measurementIntervalMs = Math.max(0, (simulationDurationS || 0) * 1000);
    return {
      config,
      events: [],
      packets: [],
      timeSeries: [],
      senderStats: validSenders.map(s => ({
        senderId: s.id,
        priority: s.priority,
        packetsSent: 0,
        packetsDelivered: 0,
        packetsDropped: 0,
        avgDelayMs: 0,
        throughputMbps: 0,
      })),
      totalPacketsSent: 0,
      totalPacketsDelivered: 0,
      totalPacketsDropped: 0,
      deliveredThroughputMbps: 0,
      avgEndToEndDelayMs: 0,
      packetLossPercent: 0,
      peakQueueOccupancy: 0,
      offeredLoadMbps,
      measurementIntervalMs,
      bufferSaturated: false,
      bufferSaturationTimeMs: null,
      congestionDetected: false,
      steadyStateThroughputMbps: 0,
    };
  }

  const bottleneckBps = bottleneckBandwidthMbps * 1_000_000;
  const packetBits = packetSizeBytes * 8;
  const txTimeMs = (packetBits / bottleneckBps) * 1000; // Transmission time in ms
  const simDurationMs = simulationDurationS * 1000;
  const propDelayMs = Math.max(0, propagationDelayMs || 0);

  // ─── Phase 1: Generate all packets ──────────────────────────────────
  const rng = new SeededRandom(randomSeed);
  const allPackets: Packet[] = [];
  const arrivalEvents: InternalEvent[] = [];
  let packetIdCounter = 0;

  for (const sender of validSenders) {
    if (sender.rateMbps <= 0) continue;

    const rateBps = sender.rateMbps * 1_000_000;
    const baseInterPacketMs = (packetBits / rateBps) * 1000;
    const senderPriority = sender.priority ?? 'normal';

    let currentTime = 0;

    if (trafficPattern === 'constant') {
      // Constant bit-rate: uniform inter-packet spacing
      // First packet from each sender at time 0
      while (currentTime < simDurationMs) {
        const pkt: Packet = {
          id: packetIdCounter,
          senderId: sender.id,
          priority: senderPriority,
          generatedAt: currentTime,
          arrivedAt: currentTime, // Assume negligible sender-to-router delay for access links
          dropped: false,
        };
        allPackets.push(pkt);

        arrivalEvents.push({
          time: currentTime,
          type: 'packet_arrived',
          packetId: packetIdCounter,
          senderId: sender.id,
          priority: EVENT_PRIORITY['packet_arrived'],
        });

        packetIdCounter++;
        currentTime += baseInterPacketMs;
      }
    } else {
      // Bursty traffic: exponentially distributed inter-packet times
      // Mean inter-packet time matches the configured rate on average
      while (currentTime < simDurationMs) {
        const pkt: Packet = {
          id: packetIdCounter,
          senderId: sender.id,
          priority: senderPriority,
          generatedAt: currentTime,
          arrivedAt: currentTime,
          dropped: false,
        };
        allPackets.push(pkt);

        arrivalEvents.push({
          time: currentTime,
          type: 'packet_arrived',
          packetId: packetIdCounter,
          senderId: sender.id,
          priority: EVENT_PRIORITY['packet_arrived'],
        });

        packetIdCounter++;
        // Exponential inter-arrival time with mean = baseInterPacketMs
        const gap = rng.nextExponential(baseInterPacketMs);
        currentTime += Math.max(gap, 0.001); // Minimum 1μs gap
      }
    }
  }

  // Sort arrivals chronologically, then by packet ID for determinism
  arrivalEvents.sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time;
    return a.packetId - b.packetId;
  });

  // ─── Phase 2: Process events through the bottleneck ─────────────────

  const events: SimEvent[] = [];
  // Multi-band priority queues: highQueue (priority: 'high') & normalQueue
  const highQueue: number[] = [];
  const normalQueue: number[] = [];
  let linkBusy = false;
  let peakQueue = 0;

  function getQueueLength(): number {
    return highQueue.length + normalQueue.length;
  }

  function enqueuePacket(pktId: number) {
    const pkt = allPackets[pktId];
    if (queuePolicy === 'priority' && pkt.priority === 'high') {
      highQueue.push(pktId);
    } else {
      normalQueue.push(pktId);
    }
  }

  function dequeuePacket(): number | null {
    if (queuePolicy === 'priority') {
      if (highQueue.length > 0) return highQueue.shift()!;
      if (normalQueue.length > 0) return normalQueue.shift()!;
      return null;
    }
    return normalQueue.length > 0 ? normalQueue.shift()! : null;
  }

  function recordEvent(
    time: number,
    type: SimEvent['type'],
    packetId: number,
    senderId: string,
    meta?: Record<string, number | string>
  ) {
    events.push({ time, type, packetId, senderId, metadata: meta });
  }

  function startTransmission(time: number) {
    if (getQueueLength() === 0 || linkBusy) return;

    const pktId = dequeuePacket()!;
    const pkt = allPackets[pktId];

    linkBusy = true;
    pkt.txStartAt = time;

    const completeTime = time + txTimeMs;
    pkt.txCompleteAt = completeTime;

    recordEvent(time, 'tx_start', pktId, pkt.senderId);

    // Schedule tx_complete
    pendingDepartures.push({
      time: completeTime,
      type: 'tx_complete',
      packetId: pktId,
      senderId: pkt.senderId,
      priority: EVENT_PRIORITY['tx_complete'],
    });
  }

  // Merge arrival events with departure events in order
  const pendingDepartures: InternalEvent[] = [];
  let arrIdx = 0;

  function getNextEvent(): InternalEvent | null {
    const hasArrival = arrIdx < arrivalEvents.length;
    const hasDeparture = pendingDepartures.length > 0;

    if (!hasArrival && !hasDeparture) return null;

    if (hasArrival && !hasDeparture) {
      return arrivalEvents[arrIdx++];
    }

    if (!hasArrival && hasDeparture) {
      // Find earliest departure
      pendingDepartures.sort((a, b) => a.time - b.time || a.priority - b.priority);
      return pendingDepartures.shift()!;
    }

    // Both exist — pick the one with earlier time, tie-break by priority
    const arr = arrivalEvents[arrIdx];
    pendingDepartures.sort((a, b) => a.time - b.time || a.priority - b.priority);
    const dep = pendingDepartures[0];

    if (dep.time < arr.time || (dep.time === arr.time && dep.priority <= arr.priority)) {
      pendingDepartures.shift();
      return dep;
    } else {
      arrIdx++;
      return arr;
    }
  }

  let evt: InternalEvent | null;
  while ((evt = getNextEvent()) !== null) {
    const { time, type, packetId, senderId } = evt;

    if (type === 'packet_arrived') {
      const pkt = allPackets[packetId];
      recordEvent(time, 'packet_arrived', packetId, senderId);

      const isHigh = queuePolicy === 'priority' && pkt.priority === 'high';
      const targetQueue = isHigh ? highQueue : normalQueue;
      const totalQ = getQueueLength();

      if (!linkBusy && totalQ === 0) {
        // Link is idle: immediately enqueue and start transmission
        pkt.enqueuedAt = time;
        enqueuePacket(packetId);
        recordEvent(time, 'packet_enqueued', packetId, senderId, {
          queueLength: 0,
        });
        startTransmission(time);
      } else if (targetQueue.length >= queueCapacity) {
        // Queue for this class is full: drop packet (Drop-Tail)
        pkt.dropped = true;
        recordEvent(time, 'packet_dropped', packetId, senderId, {
          queueLength: totalQ,
          classQueueLength: targetQueue.length,
        });
      } else {
        // Enqueue into waiting queue
        pkt.enqueuedAt = time;
        enqueuePacket(packetId);
        const newLen = getQueueLength();
        recordEvent(time, 'packet_enqueued', packetId, senderId, {
          queueLength: newLen,
        });

        if (newLen > peakQueue) peakQueue = newLen;
      }
    } else if (type === 'tx_complete') {
      const pkt = allPackets[packetId];
      linkBusy = false;
      recordEvent(time, 'tx_complete', packetId, senderId);

      // Packet is delivered after propagation delay
      const deliveryTime = time + propDelayMs;
      pkt.deliveredAt = deliveryTime;
      recordEvent(deliveryTime, 'packet_delivered', packetId, senderId);

      // Start next transmission if queue has waiting packets
      if (getQueueLength() > 0) {
        startTransmission(time);
      }
    }
  }

  // Ensure all events are strictly sorted chronologically
  events.sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time;
    return (EVENT_PRIORITY[a.type] ?? 99) - (EVENT_PRIORITY[b.type] ?? 99);
  });

  // ─── Phase 3: Compute metrics ───────────────────────────────────────

  const deliveredPackets = allPackets.filter(p => !p.dropped && p.deliveredAt !== undefined);
  const droppedPackets = allPackets.filter(p => p.dropped);

  const totalSent = allPackets.length;
  const totalDelivered = deliveredPackets.length;
  const totalDropped = droppedPackets.length;

  // Measurement interval: from t=0 to the last delivery (safe loop without stack overflow)
  let lastDeliveryTime = simDurationMs;
  for (const p of deliveredPackets) {
    if (p.deliveredAt !== undefined && p.deliveredAt > lastDeliveryTime) {
      lastDeliveryTime = p.deliveredAt;
    }
  }
  const measurementIntervalMs = Math.max(lastDeliveryTime, simDurationMs);

  // Delivered throughput based on actual delivered data
  const deliveredBits = totalDelivered * packetBits;
  const deliveredThroughputMbps = measurementIntervalMs > 0
    ? (deliveredBits / (measurementIntervalMs / 1000)) / 1_000_000
    : 0;

  // Average end-to-end delay
  const avgDelay = totalDelivered > 0
    ? deliveredPackets.reduce((sum, p) => sum + (p.deliveredAt! - p.generatedAt), 0) / totalDelivered
    : 0;

  // Packet loss percentage
  const packetLossPercent = totalSent > 0
    ? (totalDropped / totalSent) * 100
    : 0;

  // Buffer saturation detection
  const bufferSaturated = queueCapacity > 0 ? peakQueue >= queueCapacity : totalDropped > 0;
  const firstDropEvent = events.find(e => e.type === 'packet_dropped');
  const bufferSaturationTimeMs = firstDropEvent ? firstDropEvent.time : null;

  // ─── Time-series sampling ───────────────────────────────────────────
  const SAMPLE_INTERVAL_MS = 100; // 100ms sampling windows
  const timeSeries: MetricSample[] = [];

  for (let t = 0; t < measurementIntervalMs; t += SAMPLE_INTERVAL_MS) {
    const windowEnd = t + SAMPLE_INTERVAL_MS;

    // Packets delivered in this window
    const windowDelivered = deliveredPackets.filter(
      p => p.deliveredAt! >= t && p.deliveredAt! < windowEnd
    );

    // Packets dropped in this window
    const windowDropped = droppedPackets.filter(p => {
      const dropTime = p.arrivedAt;
      return dropTime >= t && dropTime < windowEnd;
    });

    // Throughput for this window
    const windowBits = windowDelivered.length * packetBits;
    const windowThroughputMbps = (windowBits / (SAMPLE_INTERVAL_MS / 1000)) / 1_000_000;

    // Queue length at end of window — count packets enqueued but not yet transmitted
    const queueAtTime = allPackets.filter(p => {
      if (p.dropped) return false;
      if (p.enqueuedAt === undefined) return false;
      const entered = p.enqueuedAt;
      const left = p.txStartAt ?? Infinity;
      return entered <= windowEnd && left > windowEnd;
    }).length;

    // Average delay of packets delivered in window
    const windowAvgDelay = windowDelivered.length > 0
      ? windowDelivered.reduce((s, p) => s + (p.deliveredAt! - p.generatedAt), 0) / windowDelivered.length
      : 0;

    // Offered load in this window
    const windowGenerated = allPackets.filter(
      p => p.generatedAt >= t && p.generatedAt < windowEnd
    );
    const windowOfferedBits = windowGenerated.length * packetBits;
    const windowOfferedMbps = (windowOfferedBits / (SAMPLE_INTERVAL_MS / 1000)) / 1_000_000;

    timeSeries.push({
      time: t,
      throughputMbps: windowThroughputMbps,
      queueLength: queueAtTime,
      avgDelayMs: windowAvgDelay,
      droppedInWindow: windowDropped.length,
      offeredLoadMbps: windowOfferedMbps,
    });
  }

  // Per-sender stats
  const senderStats: SenderStats[] = validSenders.map(sender => {
    const senderPackets = allPackets.filter(p => p.senderId === sender.id);
    const senderDelivered = senderPackets.filter(p => !p.dropped && p.deliveredAt !== undefined);
    const senderDropped = senderPackets.filter(p => p.dropped);

    const senderDeliveredBits = senderDelivered.length * packetBits;
    const senderThroughput = measurementIntervalMs > 0
      ? (senderDeliveredBits / (measurementIntervalMs / 1000)) / 1_000_000
      : 0;

    const senderAvgDelay = senderDelivered.length > 0
      ? senderDelivered.reduce((s, p) => s + (p.deliveredAt! - p.generatedAt), 0) / senderDelivered.length
      : 0;

    return {
      senderId: sender.id,
      priority: sender.priority,
      packetsSent: senderPackets.length,
      packetsDelivered: senderDelivered.length,
      packetsDropped: senderDropped.length,
      avgDelayMs: senderAvgDelay,
      throughputMbps: senderThroughput,
    };
  });

  // Steady-state throughput (last 50% of simulation)
  const steadyStartIdx = Math.floor(timeSeries.length / 2);
  const steadySamples = timeSeries.slice(steadyStartIdx);
  const steadyStateThroughputMbps = steadySamples.length > 0
    ? steadySamples.reduce((s, sample) => s + sample.throughputMbps, 0) / steadySamples.length
    : deliveredThroughputMbps;

  const congestionDetected = totalDropped > 0 || peakQueue >= queueCapacity;

  return {
    config,
    events,
    packets: allPackets,
    timeSeries,
    senderStats,
    totalPacketsSent: totalSent,
    totalPacketsDelivered: totalDelivered,
    totalPacketsDropped: totalDropped,
    deliveredThroughputMbps,
    avgEndToEndDelayMs: avgDelay,
    packetLossPercent,
    peakQueueOccupancy: peakQueue,
    offeredLoadMbps,
    measurementIntervalMs,
    bufferSaturated,
    bufferSaturationTimeMs,
    congestionDetected,
    steadyStateThroughputMbps,
  };
}
