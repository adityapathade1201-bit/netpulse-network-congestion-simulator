/**
 * Memory-bounded, packet-by-packet simulator for high offered packet counts.
 *
 * Every packet is still processed by the queue/service logic. To prevent browser
 * memory exhaustion, only a deterministic sample of per-packet visual events is
 * retained; aggregate metrics and per-sender counts include every packet.
 * This is not a fluid/averaged model.
 */
import type {
  MetricSample,
  Packet,
  SenderConfig,
  SenderStats,
  SimEvent,
  SimulationConfig,
  SimulationResults,
} from './types';
import { SeededRandom } from './SeededRandom';

const SAMPLE_INTERVAL_MS = 100;
const VISUAL_PACKET_BUDGET = 3_000;

interface StreamPacket extends Packet {
  trace: boolean;
}

interface SourceState {
  sender: SenderConfig;
  baseGapMs: number;
  nextArrivalMs: number;
}

interface SenderAggregate {
  packetsSent: number;
  packetsDelivered: number;
  packetsDropped: number;
  delayTotalMs: number;
}

interface WindowAggregate {
  generated: number;
  delivered: number;
  dropped: number;
  delayTotalMs: number;
}

const EVENT_PRIORITY: Record<string, number> = {
  tx_complete: 0,
  packet_delivered: 1,
  tx_start: 2,
  packet_enqueued: 3,
  packet_arrived: 4,
  packet_generated: 5,
  packet_dropped: 6,
  control_adjustment: 7,
};

export function runStreamingSimulation(config: SimulationConfig): SimulationResults {
  const senders = config.senders ?? [];
  const activeSenders = senders.filter(sender => Number.isFinite(sender.rateMbps) && sender.rateMbps > 0);
  const offeredLoadMbps = activeSenders.reduce((sum, sender) => sum + sender.rateMbps, 0);
  const durationMs = Math.max(0, Number(config.simulationDurationS) * 1000 || 0);
  const packetSizeBytes = Math.max(1, Math.floor(Number(config.packetSizeBytes) || 1));
  const queueCapacity = Math.max(0, Math.floor(Number(config.queueCapacity) || 0));
  const bandwidthMbps = Math.max(0, Number(config.bottleneckBandwidthMbps) || 0);
  const propagationMs = Math.max(0, Number(config.propagationDelayMs) || 0);
  const packetBits = packetSizeBytes * 8;

  if (durationMs <= 0 || bandwidthMbps <= 0 || activeSenders.length === 0) {
    return emptyResult(config, offeredLoadMbps, durationMs);
  }

  const txTimeMs = (packetBits / (bandwidthMbps * 1_000_000)) * 1000;
  const estimatedPackets = (offeredLoadMbps * 1_000_000 * (durationMs / 1000)) / packetBits;
  const traceStride = Math.max(1, Math.ceil(estimatedPackets / VISUAL_PACKET_BUDGET));
  const rng = new SeededRandom(config.randomSeed);
  const autoControl = Boolean(config.automaticCongestionControl);

  const sources: SourceState[] = activeSenders.map(sender => ({
    sender,
    baseGapMs: (packetBits / (sender.rateMbps * 1_000_000)) * 1000,
    nextArrivalMs: 0,
  }));
  const aggregates = new Map<string, SenderAggregate>();
  senders.forEach(sender => aggregates.set(sender.id, {
    packetsSent: 0,
    packetsDelivered: 0,
    packetsDropped: 0,
    delayTotalMs: 0,
  }));

  const highQueue: StreamPacket[] = [];
  const normalQueue: StreamPacket[] = [];
  const tracePackets: Packet[] = [];
  const events: SimEvent[] = [];
  const windowAggregates: WindowAggregate[] = [];
  const queueAtWindowEnd: number[] = [];

  let packetIdCounter = 0;
  let inService: StreamPacket | null = null;
  let nextTxCompleteMs: number | null = null;
  let peakQueue = 0;
  let maxHighQueue = 0;
  let maxNormalQueue = 0;
  let totalSent = 0;
  let totalDelivered = 0;
  let totalDropped = 0;
  let totalDelayMs = 0;
  let lastDeliveryMs = durationMs;
  let firstDropMs: number | null = null;
  let dropsSinceFeedback = 0;
  let rateScale = 1;
  let nextFeedbackMs = SAMPLE_INTERVAL_MS;
  let nextSampleBoundaryMs = SAMPLE_INTERVAL_MS;
  let sampleWindowCount = 0;

  const queueLength = () => highQueue.length + normalQueue.length;
  const maxCombinedQueue = config.queuePolicy === 'priority' ? queueCapacity * 2 : queueCapacity;

  const getWindow = (timeMs: number): WindowAggregate => {
    const index = Math.max(0, Math.floor(timeMs / SAMPLE_INTERVAL_MS));
    while (windowAggregates.length <= index) {
      windowAggregates.push({ generated: 0, delivered: 0, dropped: 0, delayTotalMs: 0 });
    }
    return windowAggregates[index];
  };

  const recordEvent = (
    time: number,
    type: SimEvent['type'],
    packetId: number,
    senderId: string,
    metadata?: Record<string, number | string>,
    force = false,
  ) => {
    if (force || (packetId >= 0 && packetId % traceStride === 0)) {
      events.push({ time, type, packetId, senderId, metadata });
    }
  };

  const dequeue = (): StreamPacket | null => {
    if (config.queuePolicy === 'priority') {
      if (highQueue.length) return highQueue.shift()!;
      if (normalQueue.length) return normalQueue.shift()!;
      return null;
    }
    return normalQueue.length ? normalQueue.shift()! : null;
  };

  const startTransmission = (time: number) => {
    if (inService || queueLength() === 0) return;
    const packet = dequeue();
    if (!packet) return;
    inService = packet;
    packet.txStartAt = time;
    packet.txCompleteAt = time + txTimeMs;
    nextTxCompleteMs = packet.txCompleteAt;
    recordEvent(time, 'tx_start', packet.id, packet.senderId);
  };

  const scheduleNextArrival = (source: SourceState, fromMs: number) => {
    const scale = Math.max(0.15, rateScale);
    const meanGap = source.baseGapMs / (autoControl ? scale : 1);
    const gap = config.trafficPattern === 'bursty'
      ? Math.max(rng.nextExponential(meanGap), 0.001)
      : meanGap;
    const next = fromMs + gap;
    source.nextArrivalMs = next < durationMs ? next : Infinity;
  };

  const completePacket = (time: number) => {
    if (!inService) {
      nextTxCompleteMs = null;
      return;
    }
    const packet = inService;
    inService = null;
    nextTxCompleteMs = null;
    packet.txCompleteAt = time;
    const deliveryMs = time + propagationMs;
    packet.deliveredAt = deliveryMs;

    totalDelivered++;
    totalDelayMs += deliveryMs - packet.generatedAt;
    lastDeliveryMs = Math.max(lastDeliveryMs, deliveryMs);
    const aggregate = aggregates.get(packet.senderId);
    if (aggregate) {
      aggregate.packetsDelivered++;
      aggregate.delayTotalMs += deliveryMs - packet.generatedAt;
    }
    const window = getWindow(deliveryMs);
    window.delivered++;
    window.delayTotalMs += deliveryMs - packet.generatedAt;

    recordEvent(time, 'tx_complete', packet.id, packet.senderId);
    recordEvent(deliveryMs, 'packet_delivered', packet.id, packet.senderId);
    if (packet.trace) tracePackets.push(copyPacket(packet));
    startTransmission(time);
  };

  const captureQueueBoundariesBefore = (nextEventTime: number) => {
    while (nextSampleBoundaryMs < nextEventTime) {
      const index = Math.round(nextSampleBoundaryMs / SAMPLE_INTERVAL_MS) - 1;
      queueAtWindowEnd[index] = queueLength();
      sampleWindowCount = Math.max(sampleWindowCount, index + 1);
      nextSampleBoundaryMs += SAMPLE_INTERVAL_MS;
    }
  };

  const handleArrival = (time: number, sourceIndex: number) => {
    const source = sources[sourceIndex];
    const packetId = packetIdCounter++;
    const packet: StreamPacket = {
      id: packetId,
      senderId: source.sender.id,
      priority: source.sender.priority ?? 'normal',
      generatedAt: time,
      arrivedAt: time,
      dropped: false,
      trace: packetId % traceStride === 0,
    };
    totalSent++;
    const senderAggregate = aggregates.get(packet.senderId);
    if (senderAggregate) senderAggregate.packetsSent++;
    getWindow(time).generated++;
    recordEvent(time, 'packet_arrived', packet.id, packet.senderId);

    const isHigh = config.queuePolicy === 'priority' && packet.priority === 'high';
    const targetQueue = isHigh ? highQueue : normalQueue;
    const totalQueue = queueLength();

    if (!inService && totalQueue === 0) {
      // A packet may start service immediately even with a zero-capacity waiting buffer.
      packet.enqueuedAt = time;
      targetQueue.push(packet);
      recordEvent(time, 'packet_enqueued', packet.id, packet.senderId, { queueLength: 0, classQueueLength: 0 });
      startTransmission(time);
    } else if (targetQueue.length >= queueCapacity) {
      packet.dropped = true;
      totalDropped++;
      dropsSinceFeedback++;
      if (firstDropMs === null) firstDropMs = time;
      if (senderAggregate) senderAggregate.packetsDropped++;
      getWindow(time).dropped++;
      recordEvent(time, 'packet_dropped', packet.id, packet.senderId, {
        queueLength: totalQueue,
        classQueueLength: targetQueue.length,
      });
      if (packet.trace) tracePackets.push(copyPacket(packet));
    } else {
      packet.enqueuedAt = time;
      targetQueue.push(packet);
      const newLength = queueLength();
      peakQueue = Math.max(peakQueue, newLength);
      if (isHigh) maxHighQueue = Math.max(maxHighQueue, highQueue.length);
      else maxNormalQueue = Math.max(maxNormalQueue, normalQueue.length);
      recordEvent(time, 'packet_enqueued', packet.id, packet.senderId, {
        queueLength: newLength,
        classQueueLength: targetQueue.length,
      });
    }

    scheduleNextArrival(source, time);
  };

  // Process the next chronological event. Only one future arrival per sender
  // and one transmission completion are retained, so memory stays bounded.
  while (true) {
    let nextTime = Infinity;
    let nextType: 'arrival' | 'tx_complete' | 'feedback' | null = null;
    let nextSourceIndex = -1;
    let nextPriority = Infinity;

    const consider = (time: number, type: 'arrival' | 'tx_complete' | 'feedback', priority: number, sourceIndex = -1) => {
      if (time < nextTime || (time === nextTime && priority < nextPriority)) {
        nextTime = time;
        nextType = type;
        nextPriority = priority;
        nextSourceIndex = sourceIndex;
      }
    };

    for (let i = 0; i < sources.length; i++) {
      consider(sources[i].nextArrivalMs, 'arrival', 4, i);
    }
    if (nextTxCompleteMs !== null) consider(nextTxCompleteMs, 'tx_complete', 0);
    if (autoControl && nextFeedbackMs < durationMs) consider(nextFeedbackMs, 'feedback', 3);

    if (!nextType || !Number.isFinite(nextTime)) break;
    captureQueueBoundariesBefore(nextTime);

    if (nextType === 'tx_complete') {
      completePacket(nextTime);
    } else if (nextType === 'arrival') {
      handleArrival(nextTime, nextSourceIndex);
    } else {
      const maxQueue = Math.max(0, maxCombinedQueue);
      const queueRatio = maxQueue > 0
        ? queueLength() / maxQueue
        : (dropsSinceFeedback > 0 ? 1 : 0);
      const previousScale = rateScale;
      let reason = '';
      if (queueRatio >= 0.8 || dropsSinceFeedback > 0) {
        rateScale = Math.max(0.15, rateScale * 0.7);
        reason = dropsSinceFeedback > 0 ? 'packet drops observed' : 'queue pressure reached 80%';
      } else if (queueRatio <= 0.3) {
        rateScale = Math.min(1, rateScale + 0.05);
        reason = 'queue pressure is low';
      }
      if (Math.abs(rateScale - previousScale) > 1e-9) {
        recordEvent(nextTime, 'control_adjustment', -1, 'controller', {
          previousRateScale: Number(previousScale.toFixed(3)),
          rateScale: Number(rateScale.toFixed(3)),
          queueRatio: Number(queueRatio.toFixed(3)),
          reason,
        }, true);
      }
      dropsSinceFeedback = 0;
      nextFeedbackMs += SAMPLE_INTERVAL_MS;
    }
  }

  const measurementIntervalMs = Math.max(durationMs, lastDeliveryMs);
  const sampleCount = Math.ceil(measurementIntervalMs / SAMPLE_INTERVAL_MS);
  while (sampleWindowCount < sampleCount) {
    queueAtWindowEnd[sampleWindowCount] = queueLength();
    sampleWindowCount++;
    nextSampleBoundaryMs += SAMPLE_INTERVAL_MS;
  }

  const timeSeries: MetricSample[] = [];
  for (let index = 0; index < sampleCount; index++) {
    const window = windowAggregates[index] ?? { generated: 0, delivered: 0, dropped: 0, delayTotalMs: 0 };
    timeSeries.push({
      time: index * SAMPLE_INTERVAL_MS,
      throughputMbps: (window.delivered * packetBits / (SAMPLE_INTERVAL_MS / 1000)) / 1_000_000,
      queueLength: queueAtWindowEnd[index] ?? 0,
      avgDelayMs: window.delivered > 0 ? window.delayTotalMs / window.delivered : 0,
      droppedInWindow: window.dropped,
      offeredLoadMbps: (window.generated * packetBits / (SAMPLE_INTERVAL_MS / 1000)) / 1_000_000,
    });
  }

  events.sort((a, b) => a.time - b.time || (EVENT_PRIORITY[a.type] ?? 99) - (EVENT_PRIORITY[b.type] ?? 99) || a.packetId - b.packetId);
  const senderStats: SenderStats[] = senders.map(sender => {
    const aggregate = aggregates.get(sender.id)!;
    return {
      senderId: sender.id,
      priority: sender.priority,
      packetsSent: aggregate.packetsSent,
      packetsDelivered: aggregate.packetsDelivered,
      packetsDropped: aggregate.packetsDropped,
      avgDelayMs: aggregate.packetsDelivered > 0 ? aggregate.delayTotalMs / aggregate.packetsDelivered : 0,
      throughputMbps: measurementIntervalMs > 0
        ? (aggregate.packetsDelivered * packetBits / (measurementIntervalMs / 1000)) / 1_000_000
        : 0,
    };
  });

  const deliveredThroughputMbps = measurementIntervalMs > 0
    ? (totalDelivered * packetBits / (measurementIntervalMs / 1000)) / 1_000_000
    : 0;
  const packetLossPercent = totalSent > 0 ? (totalDropped / totalSent) * 100 : 0;
  const steadySamples = timeSeries.slice(Math.floor(timeSeries.length / 2));
  const steadyStateThroughputMbps = steadySamples.length > 0
    ? steadySamples.reduce((sum, sample) => sum + sample.throughputMbps, 0) / steadySamples.length
    : deliveredThroughputMbps;
  const bufferSaturated = totalDropped > 0 || (queueCapacity > 0 && (
    config.queuePolicy === 'priority'
      ? maxHighQueue >= queueCapacity || maxNormalQueue >= queueCapacity
      : peakQueue >= queueCapacity
  ));

  return {
    config,
    events,
    packets: tracePackets,
    timeSeries,
    senderStats,
    totalPacketsSent: totalSent,
    totalPacketsDelivered: totalDelivered,
    totalPacketsDropped: totalDropped,
    deliveredThroughputMbps,
    avgEndToEndDelayMs: totalDelivered > 0 ? totalDelayMs / totalDelivered : 0,
    packetLossPercent,
    peakQueueOccupancy: peakQueue,
    offeredLoadMbps,
    measurementIntervalMs,
    bufferSaturated,
    bufferSaturationTimeMs: firstDropMs,
    congestionDetected: totalDropped > 0 || (queueCapacity > 0 && bufferSaturated),
    steadyStateThroughputMbps,
    visualTraceSampled: true,
    visualTraceStride: traceStride,
    simulationMode: 'streamed-packet-level',
  };
}

function copyPacket(packet: StreamPacket): Packet {
  return {
    id: packet.id,
    senderId: packet.senderId,
    priority: packet.priority,
    generatedAt: packet.generatedAt,
    arrivedAt: packet.arrivedAt,
    enqueuedAt: packet.enqueuedAt,
    txStartAt: packet.txStartAt,
    txCompleteAt: packet.txCompleteAt,
    deliveredAt: packet.deliveredAt,
    dropped: packet.dropped,
  };
}

function emptyResult(config: SimulationConfig, offeredLoadMbps: number, measurementIntervalMs: number): SimulationResults {
  return {
    config,
    events: [],
    packets: [],
    timeSeries: [],
    senderStats: (config.senders ?? []).map(sender => ({
      senderId: sender.id,
      priority: sender.priority,
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
    visualTraceSampled: true,
    visualTraceStride: 1,
    simulationMode: 'streamed-packet-level',
  };
}
