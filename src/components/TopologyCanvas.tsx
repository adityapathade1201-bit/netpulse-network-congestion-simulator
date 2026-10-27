import { useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  type Node,
  type Edge,
  type NodeTypes,
  Position,
  Handle,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { SimulationConfig, SimulationResults } from '../engine/types';
import { Monitor, Router, Server, ArrowRight } from 'lucide-react';

// ─── Utilization thresholds ──────────────────────────────────────────
function getUtilColor(utilPct: number): string {
  if (utilPct < 70) return '#10B981';   // Green: nominal
  if (utilPct < 95) return '#F59E0B';   // Amber: elevated
  return '#EF4444';                      // Red: congested
}

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
      <div style={{ color: data.color }}>
        <Monitor size={22} />
      </div>
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
  const nodeClass = `topo-node router${data.congested ? ' congested' : ''}`;

  return (
    <div className={nodeClass}>
      <Handle type="target" position={Position.Left} style={{ background: '#0284C7', border: 'none', width: 8, height: 8 }} />
      <Handle type="source" position={Position.Right} id="out" style={{ background: '#0284C7', border: 'none', width: 8, height: 8 }} />
      <div style={{ color: '#0284C7' }}>
        <Router size={24} />
      </div>
      <div className="topo-node-label">Router R1</div>
      <div className="topo-node-sub">Ingress: {data.ingressMbps.toFixed(1)} Mbps</div>
      <div className="topo-queue-bar">
        <div
          className="topo-queue-fill"
          style={{
            width: `${Math.min(qPct, 100)}%`,
            backgroundColor: qColor,
          }}
        />
      </div>
      <div className="topo-node-sub" style={{ marginTop: 4 }}>
        Queue {data.queueLength} / {data.queueCapacity} pkts
      </div>
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
    <div className="topo-node" style={{ minWidth: 140 }}>
      <Handle type="target" position={Position.Left} style={{ background: '#0284C7', border: 'none', width: 8, height: 8 }} />
      <Handle type="source" position={Position.Right} style={{ background: '#0284C7', border: 'none', width: 8, height: 8 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', color: utilColor }}>
        <ArrowRight size={18} />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          Bottleneck
        </span>
      </div>
      <div className="topo-node-label">{data.bandwidthMbps} Mbps</div>
      <div className="topo-queue-bar">
        <div
          className="topo-queue-fill"
          style={{
            width: `${Math.min(data.utilizationPct, 100)}%`,
            backgroundColor: utilColor,
          }}
        />
      </div>
      <div className="topo-node-sub">
        {data.utilizationPct.toFixed(1)}% utilized • {data.delayMs}ms delay
      </div>
    </div>
  );
}

interface ReceiverNodeData {
  [key: string]: unknown;
}

function ReceiverNode({ data: _data }: { data: ReceiverNodeData }) {
  return (
    <div className="topo-node">
      <Handle type="target" position={Position.Left} style={{ background: '#10B981', border: 'none', width: 8, height: 8 }} />
      <div style={{ color: '#10B981' }}>
        <Server size={22} />
      </div>
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
  const offeredLoad = config.senders.reduce((s, sender) => s + sender.rateMbps, 0);

  // Compute utilization
  const utilizationPct = results
    ? (results.deliveredThroughputMbps / config.bottleneckBandwidthMbps) * 100
    : 0;

  const peakQueue = results?.peakQueueOccupancy ?? 0;
  const congested = results?.congestionDetected ?? false;

  const nodes: Node[] = useMemo(() => {
    const senderNodes: Node[] = config.senders.map((s, i) => ({
      id: s.id,
      type: 'host',
      position: { x: 50, y: 25 + i * 110 },
      data: { label: s.label, rate: s.rateMbps, color: s.color },
      draggable: false,
    }));

    return [
      ...senderNodes,
      {
        id: 'router',
        type: 'router',
        position: { x: 320, y: 130 },
        data: {
          queueLength: peakQueue,
          queueCapacity: config.queueCapacity,
          ingressMbps: offeredLoad,
          congested,
        },
        draggable: false,
      },
      {
        id: 'bottleneck',
        type: 'bottleneck',
        position: { x: 570, y: 150 },
        data: {
          bandwidthMbps: config.bottleneckBandwidthMbps,
          utilizationPct: Math.min(utilizationPct, 100),
          delayMs: config.propagationDelayMs,
          packetSize: config.packetSizeBytes,
        },
        draggable: false,
      },
      {
        id: 'receiver',
        type: 'receiver',
        position: { x: 810, y: 160 },
        data: {},
        draggable: false,
      },
    ];
  }, [config, peakQueue, congested, offeredLoad, utilizationPct]);

  const edges: Edge[] = useMemo(() => {
    const senderEdges: Edge[] = config.senders.map(s => ({
      id: `e-${s.id}-router`,
      source: s.id,
      target: 'router',
      animated: results !== null,
      style: {
        stroke: s.color,
        strokeWidth: 2,
        strokeDasharray: results ? undefined : '6 4',
        opacity: results ? 1 : 0.4,
      },
    }));

    const linkColor = getUtilColor(utilizationPct);

    return [
      ...senderEdges,
      {
        id: 'e-router-bottleneck',
        source: 'router',
        sourceHandle: 'out',
        target: 'bottleneck',
        animated: results !== null,
        style: {
          stroke: linkColor,
          strokeWidth: results ? 3 : 2,
          strokeDasharray: results ? undefined : '6 4',
          opacity: results ? 1 : 0.4,
        },
      },
      {
        id: 'e-bottleneck-receiver',
        source: 'bottleneck',
        target: 'receiver',
        animated: results !== null,
        style: {
          stroke: '#10B981',
          strokeWidth: 2,
          opacity: results ? 1 : 0.5,
        },
      },
    ];
  }, [config, results, utilizationPct]);

  const onInit = useCallback((instance: { fitView: () => void }) => {
    instance.fitView();
  }, []);

  return (
    <div className="topology-container">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={onInit}
        fitView
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1E293B" gap={20} size={1} />
      </ReactFlow>

      {/* Drop zone badge */}
      {results && results.totalPacketsDropped > 0 && (
        <div className="drop-zone-badge">
          ⊘ {results.totalPacketsDropped} pkts dropped
        </div>
      )}

      {/* Legend */}
      <div className="topology-legend">
        <span>LINK STATE:</span>
        <div className="legend-item">
          <div className="legend-dot" style={{ background: '#10B981' }} />
          <span>Nominal (&lt;70%)</span>
        </div>
        <div className="legend-item">
          <div className="legend-dot" style={{ background: '#F59E0B' }} />
          <span>Elevated (70–95%)</span>
        </div>
        <div className="legend-item">
          <div className="legend-dot" style={{ background: '#EF4444' }} />
          <span>Congested (&gt;95%)</span>
        </div>
      </div>
    </div>
  );
}
