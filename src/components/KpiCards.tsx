import { Activity, Clock, AlertTriangle, Gauge } from 'lucide-react';
import type { SimulationResults, SimulationConfig } from '../engine/types';

interface KpiCardsProps {
  config: SimulationConfig;
  results: SimulationResults | null;
}

export function KpiCards({ config, results }: KpiCardsProps) {
  const effectiveQueueCapacity = config.queuePolicy === 'priority' ? config.queueCapacity * 2 : config.queueCapacity;
  const queuePct = results && effectiveQueueCapacity > 0
    ? Math.min(100, (results.peakQueueOccupancy / effectiveQueueCapacity) * 100)
    : 0;
  const lossDanger = Boolean(results && results.packetLossPercent > 5);
  const lossWarning = Boolean(results && results.packetLossPercent > 1 && !lossDanger);
  const queueDanger = queuePct >= 95;
  const queueWarning = queuePct >= 70 && !queueDanger;

  return (
    <div className="kpi-grid netsim-metrics-grid">
      <div className="kpi-card">
        <div className="kpi-header"><span className="kpi-label">Throughput</span><span className="kpi-icon kpi-cyan"><Activity size={16} /></span></div>
        <div className="kpi-value-line"><span className={`kpi-value${results ? '' : ' muted-value'}`}>{results ? results.deliveredThroughputMbps.toFixed(2) : '—'}</span><span className="kpi-unit">Mbps</span></div>
        <div className="kpi-sub">{results ? 'Successfully delivered data per second' : 'Run simulation to see results'}</div>
      </div>

      <div className="kpi-card">
        <div className="kpi-header"><span className="kpi-label">Average Latency</span><span className="kpi-icon kpi-purple"><Clock size={16} /></span></div>
        <div className="kpi-value-line"><span className={`kpi-value${results ? '' : ' muted-value'}`}>{results ? results.avgEndToEndDelayMs.toFixed(1) : '—'}</span><span className="kpi-unit">ms</span></div>
        <div className="kpi-sub">{results ? `${Math.max(0, results.avgEndToEndDelayMs - config.propagationDelayMs).toFixed(1)} ms above propagation baseline` : 'Estimated packet delay'}</div>
      </div>

      <div className={`kpi-card${lossDanger ? ' danger' : lossWarning ? ' warning' : ''}`}>
        <div className="kpi-header"><span className="kpi-label">Packet Loss</span><span className="kpi-icon kpi-red"><AlertTriangle size={16} /></span></div>
        <div className="kpi-value-line"><span className={`kpi-value${results && lossDanger ? ' value-danger' : ''}${results ? '' : ' muted-value'}`}>{results ? results.packetLossPercent.toFixed(1) : '—'}</span><span className="kpi-unit">%</span></div>
        <div className="kpi-sub">{results ? `${results.totalPacketsDropped.toLocaleString()} dropped / ${results.totalPacketsSent.toLocaleString()} sent` : 'No packets dropped yet'}</div>
      </div>

      <div className={`kpi-card${queueDanger ? ' danger' : queueWarning ? ' warning' : ''}`}>
        <div className="kpi-header"><span className="kpi-label">Peak Queue Utilization</span><span className="kpi-icon kpi-orange"><Gauge size={16} /></span></div>
        <div className="kpi-value-line"><span className={`kpi-value${queueDanger ? ' value-danger' : ''}${results ? '' : ' muted-value'}`}>{results ? queuePct.toFixed(0) : '—'}</span><span className="kpi-unit">%</span></div>
        <div className="kpi-progress-track"><div className={`kpi-progress-fill${queueDanger ? ' danger' : queueWarning ? ' warning' : ''}`} style={{ width: `${results ? queuePct : 0}%` }} /></div>
        <div className="kpi-sub">{results ? `${results.peakQueueOccupancy} / ${effectiveQueueCapacity} packets buffered` : `Buffer capacity ${effectiveQueueCapacity} packets`}</div>
      </div>
    </div>
  );
}
