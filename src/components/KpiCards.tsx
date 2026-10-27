import type { ReactNode } from 'react';
import { Activity, Clock, AlertTriangle, BarChart3 } from 'lucide-react';
import type { SimulationResults, SimulationConfig } from '../engine/types';

interface KpiCardsProps {
  config: SimulationConfig;
  results: SimulationResults | null;
}

export function KpiCards({ config, results }: KpiCardsProps) {
  if (!results) {
    return (
      <div className="kpi-grid">
        <KpiPlaceholder label="Delivered Throughput" unit="Mbps" icon={<Activity size={16} />} />
        <KpiPlaceholder label="Average Delay" unit="ms" icon={<Clock size={16} />} />
        <KpiPlaceholder label="Packet Loss" unit="%" icon={<AlertTriangle size={16} />} />
        <KpiPlaceholder label="Peak Queue" unit="pkts" icon={<BarChart3 size={16} />} />
      </div>
    );
  }

  const lossDanger = results.packetLossPercent > 5;
  const lossWarning = results.packetLossPercent > 1 && !lossDanger;
  const queuePct = config.queueCapacity > 0
    ? (results.peakQueueOccupancy / config.queueCapacity) * 100
    : 0;
  const queueDanger = queuePct >= 95;
  const queueWarning = queuePct >= 70 && !queueDanger;

  return (
    <div className="kpi-grid">
      <div className="kpi-card">
        <div className="kpi-header">
          <span className="kpi-label">Delivered Throughput</span>
          <span className="kpi-icon"><Activity size={16} /></span>
        </div>
        <div>
          <span className="kpi-value">{results.deliveredThroughputMbps.toFixed(2)}</span>
          <span className="kpi-unit">Mbps</span>
        </div>
        <div className="kpi-sub">
          Max capacity {config.bottleneckBandwidthMbps} Mbps
        </div>
      </div>

      <div className="kpi-card">
        <div className="kpi-header">
          <span className="kpi-label">Average Delay</span>
          <span className="kpi-icon"><Clock size={16} /></span>
        </div>
        <div>
          <span className="kpi-value">{results.avgEndToEndDelayMs.toFixed(1)}</span>
          <span className="kpi-unit">ms</span>
        </div>
        <div className="kpi-sub">
          {Math.max(0, results.avgEndToEndDelayMs - config.propagationDelayMs).toFixed(1)} ms above propagation baseline
        </div>
      </div>

      <div className={`kpi-card${lossDanger ? ' danger' : lossWarning ? ' warning' : ''}`}>
        <div className="kpi-header">
          <span className="kpi-label">Packet Loss</span>
          <span className="kpi-icon"><AlertTriangle size={16} /></span>
        </div>
        <div>
          <span className="kpi-value">{results.packetLossPercent.toFixed(1)}</span>
          <span className="kpi-unit">%</span>
        </div>
        <div className="kpi-sub">
          {results.totalPacketsDropped} dropped / {results.totalPacketsSent} sent
        </div>
      </div>

      <div className={`kpi-card${queueDanger ? ' danger' : queueWarning ? ' warning' : ''}`}>
        <div className="kpi-header">
          <span className="kpi-label">Peak Queue</span>
          <span className="kpi-icon"><BarChart3 size={16} /></span>
        </div>
        <div>
          <span className="kpi-value">{results.peakQueueOccupancy}</span>
          <span className="kpi-unit">/ {config.queueCapacity} pkts</span>
        </div>
        <div className="kpi-sub">
          {config.queueCapacity === 0
            ? 'No waiting buffer'
            : `${queuePct.toFixed(0)}% buffer ${queueDanger ? 'full' : queueWarning ? 'elevated' : 'nominal'}`}
        </div>
      </div>
    </div>
  );
}

function KpiPlaceholder({ label, unit, icon }: { label: string; unit: string; icon: ReactNode }) {
  return (
    <div className="kpi-card">
      <div className="kpi-header">
        <span className="kpi-label">{label}</span>
        <span className="kpi-icon">{icon}</span>
      </div>
      <div>
        <span className="kpi-value" style={{ color: 'var(--text-muted)' }}>—</span>
        <span className="kpi-unit">{unit}</span>
      </div>
      <div className="kpi-sub">Run simulation to see results</div>
    </div>
  );
}
