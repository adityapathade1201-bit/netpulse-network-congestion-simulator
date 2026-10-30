import { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  BaseEdge,
  getBezierPath,
  type Node,
  type Edge,
  type EdgeProps,
  type NodeTypes,
  type EdgeTypes,
  Position,
  Handle,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { SimEvent, SimulationConfig, SimulationResults } from '../engine/types';
import { Monitor, Router, Server, ArrowRight, RotateCcw, Pause, Play } from 'lucide-react';

interface PacketDot {
  id: string;
  beginMs: number;
  durationMs: number;
  color: string;
}

interface PacketEdgeData extends Record<string, unknown> {
  dots: PacketDot[];
  active: boolean;
  replayKey: number;
}

type PacketFlowEdge = Edge<PacketEdgeData, 'packetFlow'>;

// ─── Utilization thresholds ──────────────────────────────────────────
function getUtilColor(utilPct: number): string {
  if (utilPct < 70) return '#10B981';
  if (utilPct < 95) return '#F59E0B';
  return '#EF4444';
}

function sampleEvents(events: SimEvent[], limit: number): SimEvent[] {
  if (events.length <= limit) return events;
  if (limit <= 1) return [events[0]];
  return Array.from({ length: limit }, (_, i) => {
    const index = Math.round((i * (events.length - 1)) / (limit - 1));
    return events[index];
  });
}

function packetDots(
  events: SimEvent[],
  color: string,
  measurementIntervalMs: number,
  replayKey: number,
  maxDots: number,
): PacketDot[] {
  if (measurementIntervalMs <= 0 || events.length === 0) return [];
  const duration = 6200;
  return sampleEvents(events, maxDots).map((event, index) => ({
    id: `${event.packetId}-${event.type}-${index}-${replayKey}`,
    beginMs: Math.max(0, Math.min(duration, (event.time / measurementIntervalMs) * duration)),
    durationMs: 620,
    color: event.type === 'packet_dropped' ? '#EF4444' : color,
  }));
}

// A custom edge replays a small, deterministic sample of the actual events returned
// by the simulation engine. It is not an independent random packet animation.
function PacketFlowEdge(props: EdgeProps<PacketFlowEdge>) {
  const [edgePath] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    curvature: 0.18,
  });
  const data = props.data;

  return (
    <>
      <BaseEdge id={props.id} path={edgePath} markerEnd={props.markerEnd} style={props.style} />
      {data?.active && data.dots.map((dot) => (
        <circle key={`${dot.id}-${data.replayKey}`} cx={props.sourceX} cy={props.sourceY} r={3.4} fill={dot.color} opacity={0}>
          <animateMotion
            path={edgePath}
            begin={`${dot.beginMs}ms`}
            dur={`${dot.durationMs}ms`}
            repeatCount="1"
            fill="freeze"
          />
          <animate
            attributeName="opacity"
            values="0;1;1;0"
            keyTimes="0;0.12;0.82;1"
            begin={`${dot.beginMs}ms`}
            dur={`${dot.durationMs}ms`}
            repeatCount="1"
            fill="freeze"
          />
        </circle>
      ))}
    </>
  );
}

const edgeTypes: EdgeTypes = { packetFlow: PacketFlowEdge };

// ─── Custom Node Components ──────────────────────────────────────────
interface HostNodeData {
  label: string;
  rate: number;
  color: string;
  [key: string]: unknown;
}

function HostNode({ data }: { data: HostNodeData }) {
  return (
    <div className="topo-node">
      <Handle type="source" position={Position.Right} style={{ background: data.color, border: 'none', width: 8, height: 8 }} />
      <div className="topo-node-icon" style={{ color: data.color }}><Monitor size={19} /></div>
      <div className="topo-node-label">{data.label}</div>
      <div className="topo-node-sub">{data.rate} Mbps</div>
    </div>
  );
}

interface RouterNodeData {
  queueLength: number;
  queueCapacity: number;
  ingressMbps: number;
  congested: boolean;
  [key: string]: unknown;
}

function RouterNode({ data }: { data: RouterNodeData }) {
  const qPct = data.queueCapacity > 0 ? (data.queueLength / data.queueCapacity) * 100 : 0;
  const qColor = qPct < 70 ? '#10B981' : qPct < 90 ? '#F59E0B' : '#EF4444';
  const nodeClass = `topo-node router${data.congested ? ' congested' : ''}${qPct >= 50 ? ' busy' : ''}`;
  return (
    <div className={nodeClass}>
      <Handle type="target" position={Position.Left} style={{ background: '#0284C7', border: 'none', width: 8, height: 8 }} />
      <Handle type="source" position={Position.Right} id="out" style={{ background: '#0284C7', border: 'none', width: 8, height: 8 }} />
      <div style={{ color: '#0284C7' }}><Router size={22} /></div>
      <div className="topo-node-label">Router R1</div>
      <div className="topo-node-sub">Ingress: {data.ingressMbps.toFixed(1)} Mbps</div>
      <div className="topo-queue-bar"><div className="topo-queue-fill" style={{ width: `${Math.min(qPct, 100)}%`, backgroundColor: qColor }} /></div>
      <div className="topo-queue-packets" aria-label={`${data.queueLength} peak queued packets`}>
        {Array.from({ length: Math.min(12, Math.ceil(qPct / 8)) }, (_, index) => (
          <span key={index} className="topo-queue-packet" style={{ animationDelay: `${index * 55}ms` }} />
        ))}
      </div>
      <div className="topo-node-sub" style={{ marginTop: 2 }}>Peak queue {data.queueLength} / {data.queueCapacity}</div>
    </div>
  );
}

interface BottleneckNodeData {
  bandwidthMbps: number;
  utilizationPct: number;
  delayMs: number;
  packetSize: number;
  [key: string]: unknown;
}

function BottleneckNode({ data }: { data: BottleneckNodeData }) {
  const utilColor = getUtilColor(data.utilizationPct);
  return (
    <div className="topo-node" style={{ minWidth: 136 }}>
      <Handle type="target" position={Position.Left} style={{ background: '#0284C7', border: 'none', width: 8, height: 8 }} />
      <Handle type="source" position={Position.Right} style={{ background: '#0284C7', border: 'none', width: 8, height: 8 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', color: utilColor }}>
        <ArrowRight size={17} />
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Bottleneck</span>
      </div>
      <div className="topo-node-label">{data.bandwidthMbps} Mbps</div>
      <div className="topo-queue-bar"><div className="topo-queue-fill" style={{ width: `${Math.min(data.utilizationPct, 100)}%`, backgroundColor: utilColor }} /></div>
      <div className="topo-node-sub">{data.utilizationPct.toFixed(1)}% utilized · {data.delayMs} ms delay</div>
    </div>
  );
}

function ReceiverNode({ data: _data }: { data: Record<string, unknown> }) {
  return (
    <div className="topo-node">
      <Handle type="target" position={Position.Left} style={{ background: '#10B981', border: 'none', width: 8, height: 8 }} />
      <div style={{ color: '#10B981' }}><Server size={21} /></div>
      <div className="topo-node-label">Receiver</div>
      <div className="topo-node-sub">Sink</div>
    </div>
  );
}

const nodeTypes: NodeTypes = {
  host: HostNode,
  router: RouterNode,
  bottleneck: BottleneckNode,
  receiver: ReceiverNode,
} as unknown as NodeTypes;

// ─── Main Component ──────────────────────────────────────────────────
interface TopologyCanvasProps {
  config: SimulationConfig;
  results: SimulationResults | null;
}

export function TopologyCanvas({ config, results }: TopologyCanvasProps) {
  const [replayKey, setReplayKey] = useState(0);
  const [animationPaused, setAnimationPaused] = useState(false);
  const topologyRootRef = useRef<HTMLDivElement>(null);

  const pauseSvgAnimations = useCallback((pause: boolean) => {
    const root = topologyRootRef.current;
    if (!root) return;
    root.querySelectorAll('svg').forEach((node) => {
      const svg = node as SVGSVGElement & { pauseAnimations?: () => void; unpauseAnimations?: () => void };
      if (pause) svg.pauseAnimations?.();
      else svg.unpauseAnimations?.();
    });
  }, []);
  const offeredLoad = config.senders.reduce((sum, sender) => sum + sender.rateMbps, 0);
  const utilizationPct = results
    ? Math.min(100, (results.deliveredThroughputMbps / Math.max(config.bottleneckBandwidthMbps, 0.001)) * 100)
    : 0;
  const peakQueue = results?.peakQueueOccupancy ?? 0;
  const congested = results?.congestionDetected ?? false;
  const intervalMs = results?.measurementIntervalMs ?? 0;

  useEffect(() => {
    if (results) {
      setAnimationPaused(false);
      setReplayKey((key) => key + 1);
      pauseSvgAnimations(false);
    }
  }, [results, pauseSvgAnimations]);

  useEffect(() => {
    pauseSvgAnimations(animationPaused);
  }, [animationPaused, replayKey, pauseSvgAnimations]);

  const makeDots = useCallback((events: SimEvent[], color: string, cap: number) =>
    packetDots(events, color, intervalMs, replayKey, cap), [intervalMs, replayKey]);

  const nodes: Node[] = useMemo(() => {
    const largeTopology = config.senders.length > 6;
    const senderNodes: Node[] = config.senders.map((sender, index) => {
      let x: number;
      let y: number;
      if (largeTopology) {
        // Up to 20 sender hosts are arranged as four compact columns of five.
        const column = Math.floor(index / 5);
        const row = index % 5;
        x = 20 + column * 132;
        y = 18 + row * 82;
      } else {
        x = 28;
        y = 22 + index * (config.senders.length <= 3 ? 104 : 82);
      }
      return {
        id: sender.id,
        type: 'host',
        position: { x, y },
        data: { label: sender.label, rate: sender.rateMbps, color: sender.color },
        draggable: false,
      };
    });

    const routerX = largeTopology ? 585 : 320;
    const routerY = largeTopology ? 180 : Math.max(45, ((config.senders.length - 1) * (config.senders.length <= 3 ? 104 : 82)) / 2 + 15);
    const bottleneckX = largeTopology ? 825 : 570;
    const receiverX = largeTopology ? 1060 : 810;

    return [
      ...senderNodes,
      {
        id: 'router', type: 'router', position: { x: routerX, y: routerY },
        data: { queueLength: peakQueue, queueCapacity: config.queuePolicy === 'priority' ? config.queueCapacity * 2 : config.queueCapacity, ingressMbps: offeredLoad, congested },
        draggable: false,
      },
      {
        id: 'bottleneck', type: 'bottleneck', position: { x: bottleneckX, y: routerY + 20 },
        data: { bandwidthMbps: config.bottleneckBandwidthMbps, utilizationPct, delayMs: config.propagationDelayMs, packetSize: config.packetSizeBytes },
        draggable: false,
      },
      { id: 'receiver', type: 'receiver', position: { x: receiverX, y: routerY + 30 }, data: {}, draggable: false },
    ];
  }, [config, peakQueue, congested, offeredLoad, utilizationPct]);

  const edges: Edge<PacketEdgeData, 'packetFlow'>[] = useMemo(() => {
    const allEvents = results?.events ?? [];
    const senderEdges: Edge<PacketEdgeData, 'packetFlow'>[] = config.senders.map((sender) => {
      const droppedIds = new Set(allEvents.filter(event => event.type === 'packet_dropped').map(event => event.packetId));
      const arrivalEvents = allEvents.filter(event =>
        event.senderId === sender.id && (
          (event.type === 'packet_arrived' && !droppedIds.has(event.packetId)) || event.type === 'packet_dropped'
        )
      );
      return {
        id: `e-${sender.id}-router`, type: 'packetFlow', source: sender.id, target: 'router',
        animated: false,
        className: results ? `netpulse-flowing-edge${animationPaused ? ' is-paused' : ''}` : 'netpulse-idle-edge',
        style: { stroke: sender.color, strokeWidth: results ? 2 : 1.5, strokeDasharray: results ? '7 7' : '6 5', opacity: results ? 0.96 : 0.48 },
        data: { active: Boolean(results), replayKey, dots: makeDots(arrivalEvents, sender.color, 8) },
      };
    });
    const txEvents = allEvents.filter(event => event.type === 'tx_start');
    const deliveredEvents = allEvents.filter(event => event.type === 'packet_delivered');
    const linkColor = getUtilColor(utilizationPct);
    return [
      ...senderEdges,
      {
        id: 'e-router-bottleneck', type: 'packetFlow', source: 'router', sourceHandle: 'out', target: 'bottleneck',
        animated: false,
        className: results ? `netpulse-flowing-edge${animationPaused ? ' is-paused' : ''}` : 'netpulse-idle-edge',
        style: { stroke: linkColor, strokeWidth: results ? 3 : 2, strokeDasharray: results ? '7 7' : '6 5', opacity: results ? 1 : 0.5 },
        data: { active: Boolean(results), replayKey, dots: makeDots(txEvents, '#38BDF8', 22) },
      },
      {
        id: 'e-bottleneck-receiver', type: 'packetFlow', source: 'bottleneck', target: 'receiver',
        animated: false,
        className: results ? `netpulse-flowing-edge${animationPaused ? ' is-paused' : ''}` : 'netpulse-idle-edge',
        style: { stroke: '#10B981', strokeWidth: results ? 2.5 : 2, strokeDasharray: results ? '7 7' : '6 5', opacity: results ? 1 : 0.5 },
        data: { active: Boolean(results), replayKey, dots: makeDots(deliveredEvents, '#34D399', 22) },
      },
    ];
  }, [config.senders, results, replayKey, utilizationPct, makeDots, animationPaused]);

  const onInit = useCallback((instance: { fitView: (options?: { padding?: number }) => void }) => {
    instance.fitView({ padding: 0.14 });
  }, []);

  const replay = () => {
    setAnimationPaused(false);
    pauseSvgAnimations(false);
    setReplayKey((key) => key + 1);
  };

  const togglePause = () => {
    const nextPaused = !animationPaused;
    pauseSvgAnimations(nextPaused);
    setAnimationPaused(nextPaused);
  };

  return (
    <section className="panel topology-panel">
      <div className="network-panel-heading">
        <div><p className="eyebrow">LIVE VISUALIZATION</p><h2>Network Topology</h2></div>
        <span className="network-panel-legend"><i /> Packet traffic</span>
      </div>
      <div ref={topologyRootRef} className={`topology-container ${config.senders.length > 6 ? 'topology-container-many-hosts' : ''}${animationPaused ? ' topology-animations-paused' : ''}`}>
      <ReactFlow
        key={config.senders.length}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={onInit}
        fitView
        fitViewOptions={{ padding: 0.14 }}
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1E293B" gap={20} size={1} />
      </ReactFlow>

      {results && (
        <div className="topology-replay-control">
          <span className="packet-replay-label">Recorded packet-flow animation</span>
          <button className="topology-replay-btn" type="button" onClick={togglePause} title={animationPaused ? 'Resume packet animation' : 'Pause packet animation'} aria-label={animationPaused ? 'Resume packet animation' : 'Pause packet animation'}>
            {animationPaused ? <Play size={13} /> : <Pause size={13} />} {animationPaused ? 'Resume' : 'Pause'}
          </button>
          <button className="topology-replay-btn" type="button" onClick={replay} title="Replay the recorded packet flow" aria-label="Replay packet animation">
            <RotateCcw size={13} /> Replay
          </button>
        </div>
      )}

      {results && results.totalPacketsDropped > 0 && (
        <div className="drop-zone-badge">⊘ {results.totalPacketsDropped.toLocaleString()} pkts dropped</div>
      )}

      <div className="topology-legend">
        <span>LINK STATE:</span>
        <div className="legend-item"><div className="legend-dot" style={{ background: '#10B981' }} /><span>Nominal (&lt;70%)</span></div>
        <div className="legend-item"><div className="legend-dot" style={{ background: '#F59E0B' }} /><span>Elevated (70–95%)</span></div>
        <div className="legend-item"><div className="legend-dot" style={{ background: '#EF4444' }} /><span>Congested (&gt;95%)</span></div>
      </div>
      </div>
    </section>
  );
}
