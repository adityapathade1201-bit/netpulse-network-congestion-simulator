/**
 * Educational feedback-control simulation used when automaticCongestionControl is enabled.
 * This is a queue-pressure-based sender rate controller, not TCP Reno/CUBIC/BBR.
 * Unlike the main discrete-event model, feedback mode uses an event scheduler with
 * one outstanding arrival per source so later packet gaps can respond to feedback.
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

interface InternalEvent {
  time: number;
  type: 'packet_arrived' | 'tx_complete' | 'feedback';
  packetId: number;
  senderId: string;
  priority: number;
}

interface SourceState {
  sender: SenderConfig;
  baseGapMs: number;
}

const PRIORITY: Record<string, number> = {
  tx_complete: 0,
  feedback: 3,
  packet_arrived: 4,
  packet_generated: 5,
  packet_enqueued: 6,
  packet_dropped: 7,
  tx_start: 2,
  packet_delivered: 1,
  control_adjustment: 8,
};

export function runAdaptiveSimulation(config: SimulationConfig): SimulationResults {
  const senders = config.senders ?? [];
  const offeredLoadMbps = senders.reduce((sum, sender) => sum + Math.max(0, sender.rateMbps), 0);
  const durationMs = Math.max(0, config.simulationDurationS * 1000);
  const packetSizeBytes = Math.max(1, config.packetSizeBytes);
  const queueCapacity = Math.max(0, Math.floor(config.queueCapacity));
  const bandwidthMbps = Math.max(0, config.bottleneckBandwidthMbps);
  const propagationMs = Math.max(0, config.propagationDelayMs || 0);

  if (durationMs <= 0 || packetSizeBytes <= 0 || bandwidthMbps <= 0 || senders.length === 0) {
    return emptyResult(config, offeredLoadMbps, durationMs);
  }

  const packetBits = packetSizeBytes * 8;
  const txTimeMs = (packetBits / (bandwidthMbps * 1_000_000)) * 1000;
  const rng = new SeededRandom(config.randomSeed);
  const allPackets: Packet[] = [];
  const events: SimEvent[] = [];
  const pendingArrivals: InternalEvent[] = [];
  const pendingDepartures: InternalEvent[] = [];
  const highQueue: number[] = [];
  const normalQueue: number[] = [];
  const sourceById = new Map<string, SourceState>();

  let nextPacketId = 0;
  let linkBusy = false;
  let peakQueue = 0;
  let firstDropTime: number | null = null;
  let dropsSinceFeedback = 0;
  let rateScale = 1;
  let nextFeedbackMs = 100;

  const getQueueLength = () => highQueue.length + normalQueue.length;
  const maxQueueOccupancy = config.queuePolicy === 'priority' ? queueCapacity * 2 : queueCapacity;

  const recordEvent = (
    time: number,
    type: SimEvent['type'],
    packetId: number,
    senderId: string,
    metadata?: Record<string, number | string>,
  ) => events.push({ time, type, packetId, senderId, metadata });

  const enqueue = (packetId: number) => {
    const packet = allPackets[packetId];
    if (config.queuePolicy === 'priority' && packet.priority === 'high') highQueue.push(packetId);
    else normalQueue.push(packetId);
  };

  const dequeue = (): number | null => {
    if (config.queuePolicy === 'priority') {
      if (highQueue.length > 0) return highQueue.shift()!;
      if (normalQueue.length > 0) return normalQueue.shift()!;
      return null;
    }
    return normalQueue.length > 0 ? normalQueue.shift()! : null;
  };

  const scheduleArrival = (source: SourceState, fromTime: number, initial = false) => {
    if (fromTime >= durationMs) return;
    const scale = Math.max(0.15, rateScale);
    const meanGapMs = source.baseGapMs / scale;
    const gapMs = initial
      ? 0
      : config.trafficPattern === 'constant'
        ? meanGapMs
        : rng.nextExponential(meanGapMs);
    const time = fromTime + Math.max(0, gapMs);
    if (time >= durationMs) return;

    const packet: Packet = {
      id: nextPacketId++,
      senderId: source.sender.id,
      priority: config.queuePolicy === 'priority'
        ? (source.sender.priority ?? 'normal')
        : (source.sender.priority ?? 'normal'),
      generatedAt: time,
      arrivedAt: time,
      dropped: false,
    };
    allPackets.push(packet);
    pendingArrivals.push({
      time,
      type: 'packet_arrived',
      packetId: packet.id,
      senderId: source.sender.id,
      priority: PRIORITY.packet_arrived,
    });
  };

  const startTransmission = (time: number) => {
    if (getQueueLength() === 0 || linkBusy) return;
    const packetId = dequeue();
    if (packetId === null) return;
    const packet = allPackets[packetId];
    linkBusy = true;
    packet.txStartAt = time;
    packet.txCompleteAt = time + txTimeMs;
    recordEvent(time, 'tx_start', packetId, packet.senderId);
    pendingDepartures.push({
      time: time + txTimeMs,
      type: 'tx_complete',
      packetId,
      senderId: packet.senderId,
      priority: PRIORITY.tx_complete,
    });
  };

  for (const sender of senders) {
    if (sender.rateMbps <= 0) continue;
    const source: SourceState = {
      sender,
      baseGapMs: (packetBits / (sender.rateMbps * 1_000_000)) * 1000,
    };
    sourceById.set(sender.id, source);
    scheduleArrival(source, 0, true);
  }

  const takeNextEvent = (): InternalEvent | null => {
    pendingArrivals.sort((a, b) => a.time - b.time || a.packetId - b.packetId);
    pendingDepartures.sort((a, b) => a.time - b.time || a.priority - b.priority);
    const candidates: InternalEvent[] = [];
    if (pendingArrivals.length) candidates.push(pendingArrivals[0]);
    if (pendingDepartures.length) candidates.push(pendingDepartures[0]);
    if (nextFeedbackMs < durationMs) {
      candidates.push({
        time: nextFeedbackMs,
        type: 'feedback',
        packetId: -1,
        senderId: 'controller',
        priority: PRIORITY.feedback,
      });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => a.time - b.time || a.priority - b.priority || a.packetId - b.packetId);
    const next = candidates[0];
    if (next.type === 'packet_arrived') pendingArrivals.shift();
    else if (next.type === 'tx_complete') pendingDepartures.shift();
    else nextFeedbackMs += 100;
    return next;
  };

  let evt: InternalEvent | null;
  while ((evt = takeNextEvent()) !== null) {
    const { time, type, packetId, senderId } = evt;

    if (type === 'packet_arrived') {
      const packet = allPackets[packetId];
      recordEvent(time, 'packet_generated', packetId, senderId);
      recordEvent(time, 'packet_arrived', packetId, senderId);

      const isHigh = config.queuePolicy === 'priority' && packet.priority === 'high';
      const targetQueue = isHigh ? highQueue : normalQueue;
      const totalQueue = getQueueLength();

      if (!linkBusy && totalQueue === 0) {
        packet.enqueuedAt = time;
        enqueue(packetId);
        recordEvent(time, 'packet_enqueued', packetId, senderId, { queueLength: 0 });
        startTransmission(time);
      } else if (targetQueue.length >= queueCapacity) {
        packet.dropped = true;
        dropsSinceFeedback++;
        if (firstDropTime === null) firstDropTime = time;
        recordEvent(time, 'packet_dropped', packetId, senderId, {
          queueLength: totalQueue,
          classQueueLength: targetQueue.length,
          feedbackEnabled: 1,
        });
      } else {
        packet.enqueuedAt = time;
        enqueue(packetId);
        const newLength = getQueueLength();
        peakQueue = Math.max(peakQueue, newLength);
        recordEvent(time, 'packet_enqueued', packetId, senderId, { queueLength: newLength, classQueueLength: targetQueue.length });
      }

      const source = sourceById.get(senderId);
      if (source) scheduleArrival(source, time);
    } else if (type === 'tx_complete') {
      const packet = allPackets[packetId];
      linkBusy = false;
      packet.txCompleteAt = time;
      recordEvent(time, 'tx_complete', packetId, senderId);
      packet.deliveredAt = time + propagationMs;
      recordEvent(packet.deliveredAt, 'packet_delivered', packetId, senderId);
      if (getQueueLength() > 0) startTransmission(time);
    } else if (type === 'feedback') {
      const queueRatio = maxQueueOccupancy > 0
        ? getQueueLength() / maxQueueOccupancy
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
        recordEvent(time, 'control_adjustment', -1, 'controller', {
          previousRateScale: Number(previousScale.toFixed(3)),
          rateScale: Number(rateScale.toFixed(3)),
          queueRatio: Number(queueRatio.toFixed(3)),
          reason,
        });
      }
      dropsSinceFeedback = 0;
    }
  }

  events.sort((a, b) => a.time - b.time || (PRIORITY[a.type] ?? 99) - (PRIORITY[b.type] ?? 99) || a.packetId - b.packetId);

  const deliveredPackets = allPackets.filter(p => !p.dropped && p.deliveredAt !== undefined);
  const droppedPackets = allPackets.filter(p => p.dropped);
  const totalSent = allPackets.length;
  const totalDelivered = deliveredPackets.length;
  const totalDropped = droppedPackets.length;
  let lastDeliveryTime = durationMs;
  for (const packet of deliveredPackets) {
    if (packet.deliveredAt !== undefined && packet.deliveredAt > lastDeliveryTime) lastDeliveryTime = packet.deliveredAt;
  }
  const measurementIntervalMs = Math.max(durationMs, lastDeliveryTime);
  const deliveredThroughputMbps = measurementIntervalMs > 0
    ? (totalDelivered * packetBits / (measurementIntervalMs / 1000)) / 1_000_000
    : 0;
  const avgEndToEndDelayMs = totalDelivered > 0
    ? deliveredPackets.reduce((sum, packet) => sum + ((packet.deliveredAt ?? 0) - packet.generatedAt), 0) / totalDelivered
    : 0;
  const packetLossPercent = totalSent > 0 ? totalDropped / totalSent * 100 : 0;
  const bufferSaturated = config.queuePolicy === 'priority'
    ? totalDropped > 0 || (queueCapacity > 0 && events.some(event => event.type === 'packet_enqueued' && Number(event.metadata?.classQueueLength ?? 0) >= queueCapacity))
    : queueCapacity > 0 ? peakQueue >= queueCapacity : totalDropped > 0;

  const timeSeries: MetricSample[] = [];
  const sampleInterval = 100;
  const deliveredByTime = [...deliveredPackets].sort((a, b) => (a.deliveredAt ?? 0) - (b.deliveredAt ?? 0));
  const droppedByTime = [...droppedPackets].sort((a, b) => a.arrivedAt - b.arrivedAt);
  const generatedByTime = [...allPackets].sort((a, b) => a.generatedAt - b.generatedAt);
  const enqueueTimes = allPackets
    .filter(packet => !packet.dropped && packet.enqueuedAt !== undefined)
    .map(packet => packet.enqueuedAt as number)
    .sort((a, b) => a - b);
  const txStartTimes = allPackets
    .filter(packet => !packet.dropped && packet.txStartAt !== undefined)
    .map(packet => packet.txStartAt as number)
    .sort((a, b) => a - b);

  let deliveredCursor = 0;
  let droppedCursor = 0;
  let generatedCursor = 0;
  let enqueueCursor = 0;
  let txStartCursor = 0;

  for (let start = 0; start < measurementIntervalMs; start += sampleInterval) {
    const end = start + sampleInterval;
    let windowDelivered = 0;
    let windowDelayTotal = 0;
    let windowDropped = 0;
    let windowGenerated = 0;

    while (deliveredCursor < deliveredByTime.length) {
      const packet = deliveredByTime[deliveredCursor];
      const deliveredAt = packet.deliveredAt ?? Infinity;
      if (deliveredAt >= end) break;
      windowDelivered++;
      windowDelayTotal += deliveredAt - packet.generatedAt;
      deliveredCursor++;
    }
    while (droppedCursor < droppedByTime.length && droppedByTime[droppedCursor].arrivedAt < end) {
      windowDropped++;
      droppedCursor++;
    }
    while (generatedCursor < generatedByTime.length && generatedByTime[generatedCursor].generatedAt < end) {
      windowGenerated++;
      generatedCursor++;
    }
    while (enqueueCursor < enqueueTimes.length && enqueueTimes[enqueueCursor] <= end) enqueueCursor++;
    while (txStartCursor < txStartTimes.length && txStartTimes[txStartCursor] <= end) txStartCursor++;
    const queueLength = Math.max(0, enqueueCursor - txStartCursor);

    timeSeries.push({
      time: start,
      throughputMbps: (windowDelivered * packetBits / (sampleInterval / 1000)) / 1_000_000,
      queueLength,
      avgDelayMs: windowDelivered > 0 ? windowDelayTotal / windowDelivered : 0,
      droppedInWindow: windowDropped,
      offeredLoadMbps: (windowGenerated * packetBits / (sampleInterval / 1000)) / 1_000_000,
    });
  }

  const senderAggregates = new Map<string, {
    packetsSent: number;
    packetsDelivered: number;
    packetsDropped: number;
    delayTotalMs: number;
  }>();
  for (const sender of senders) {
    senderAggregates.set(sender.id, { packetsSent: 0, packetsDelivered: 0, packetsDropped: 0, delayTotalMs: 0 });
  }
  for (const packet of allPackets) {
    const aggregate = senderAggregates.get(packet.senderId);
    if (!aggregate) continue;
    aggregate.packetsSent++;
    if (packet.dropped) aggregate.packetsDropped++;
    else if (packet.deliveredAt !== undefined) {
      aggregate.packetsDelivered++;
      aggregate.delayTotalMs += packet.deliveredAt - packet.generatedAt;
    }
  }
  const senderStats: SenderStats[] = senders.map(sender => {
    const aggregate = senderAggregates.get(sender.id)!;
    const senderThroughput = measurementIntervalMs > 0
      ? (aggregate.packetsDelivered * packetBits / (measurementIntervalMs / 1000)) / 1_000_000
      : 0;
    return {
      senderId: sender.id,
      priority: sender.priority,
      packetsSent: aggregate.packetsSent,
      packetsDelivered: aggregate.packetsDelivered,
      packetsDropped: aggregate.packetsDropped,
      avgDelayMs: aggregate.packetsDelivered > 0 ? aggregate.delayTotalMs / aggregate.packetsDelivered : 0,
      throughputMbps: senderThroughput,
    };
  });

  const steadySamples = timeSeries.slice(Math.floor(timeSeries.length / 2));
  const steadyStateThroughputMbps = steadySamples.length > 0
    ? steadySamples.reduce((sum, sample) => sum + sample.throughputMbps, 0) / steadySamples.length
    : deliveredThroughputMbps;

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
    avgEndToEndDelayMs,
    packetLossPercent,
    peakQueueOccupancy: peakQueue,
    offeredLoadMbps,
    measurementIntervalMs,
    bufferSaturated,
    bufferSaturationTimeMs: firstDropTime,
    congestionDetected: totalDropped > 0 || peakQueue >= Math.max(1, queueCapacity),
    steadyStateThroughputMbps,
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
  };
}
