/**
 * NetPulse Simulation Engine — Core Types
 * 
 * This file defines all types for the discrete-event packet-level simulation.
 * 
 * ## Model Assumptions
 * - Traffic sources generate packets at a constant or bursty rate.
 * - A single FIFO queue sits at the bottleneck router.
 * - Queue capacity = max packets WAITING (excludes the packet currently being transmitted).
 * - Drop-Tail policy: arriving packets are dropped when the queue is full.
 * - Propagation delay is a fixed value applied once per packet (sender→receiver).
 * - Transmission delay = packetSizeBytes * 8 / linkBandwidthBps.
 * - Queueing delay = time spent waiting in the FIFO queue.
 * - End-to-end delay = queueing delay + transmission delay + propagation delay.
 * - No TCP feedback, no retransmissions, no windowing in this milestone.
 */

// ─── Simulation Configuration ───────────────────────────────────────────────

export interface SenderConfig {
  id: string;
  label: string;
  rateMbps: number;        // Sending rate in megabits per second
  color: string;           // Display color for this sender
  priority?: 'high' | 'normal'; // Priority class for strict-priority queueing
}

export type TrafficPattern = 'constant' | 'bursty';

export type QueuePolicy = 'drop-tail' | 'priority';

export interface SimulationConfig {
  senders: SenderConfig[];
  bottleneckBandwidthMbps: number;    // Bottleneck link capacity
  packetSizeBytes: number;             // Packet size in bytes
  propagationDelayMs: number;          // Fixed propagation delay in ms
  queueCapacity: number;               // Max packets WAITING (excl. in-service)
  simulationDurationS: number;         // Traffic generation duration in seconds
  randomSeed: number;                  // Seed for deterministic bursty traffic
  trafficPattern: TrafficPattern;
  queuePolicy: QueuePolicy;           // 'drop-tail' or 'priority'
}

// ─── Simulation Events ──────────────────────────────────────────────────────

export type SimEventType =
  | 'packet_generated'    // A packet was created by a sender
  | 'packet_arrived'      // A packet arrived at the router queue
  | 'packet_enqueued'     // A packet was added to the queue
  | 'packet_dropped'      // A packet was dropped (queue full)
  | 'tx_start'            // A packet started transmission on the bottleneck link
  | 'tx_complete'         // A packet finished transmission on the bottleneck link
  | 'packet_delivered';   // A packet arrived at the receiver

export interface SimEvent {
  time: number;           // Event time in milliseconds
  type: SimEventType;
  packetId: number;       // Unique packet identifier
  senderId: string;       // Which sender generated this packet
  metadata?: Record<string, number | string>;
}

// ─── Packet ─────────────────────────────────────────────────────────────────

export interface Packet {
  id: number;
  senderId: string;
  priority?: 'high' | 'normal';
  generatedAt: number;    // ms — when the sender created it
  arrivedAt: number;      // ms — when it arrived at the router
  enqueuedAt?: number;    // ms — when it entered the queue (undefined if dropped)
  txStartAt?: number;     // ms — when transmission began
  txCompleteAt?: number;  // ms — when transmission ended
  deliveredAt?: number;   // ms — when it reached the receiver
  dropped: boolean;
}

// ─── Time-Series Samples ────────────────────────────────────────────────────

export interface MetricSample {
  time: number;                        // ms
  throughputMbps: number;              // Delivered throughput over sampling window
  queueLength: number;                 // Packets in queue at this instant
  avgDelayMs: number;                  // Average e2e delay of packets delivered in window
  droppedInWindow: number;             // Packets dropped in this window
  offeredLoadMbps: number;             // Offered load in this window
}

// ─── Per-Sender Stats ───────────────────────────────────────────────────────

export interface SenderStats {
  senderId: string;
  priority?: 'high' | 'normal';
  packetsSent: number;
  packetsDelivered: number;
  packetsDropped: number;
  avgDelayMs: number;
  throughputMbps: number;
}

// ─── Final Simulation Results ───────────────────────────────────────────────

export interface SimulationResults {
  config: SimulationConfig;
  events: SimEvent[];
  packets: Packet[];
  timeSeries: MetricSample[];
  senderStats: SenderStats[];

  // Summary metrics
  totalPacketsSent: number;
  totalPacketsDelivered: number;
  totalPacketsDropped: number;
  deliveredThroughputMbps: number;     // Based on actually delivered packets
  avgEndToEndDelayMs: number;          // Average across all delivered packets
  packetLossPercent: number;           // dropped / sent * 100
  peakQueueOccupancy: number;          // Max queue length observed
  offeredLoadMbps: number;             // Sum of sender rates
  measurementIntervalMs: number;       // Duration over which metrics are measured

  // Insights data
  bufferSaturated: boolean;            // Did queue reach capacity?
  bufferSaturationTimeMs: number | null; // When did it first saturate?
  congestionDetected: boolean;
  steadyStateThroughputMbps: number;   // Throughput after initial transient
}
