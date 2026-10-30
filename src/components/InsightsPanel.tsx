import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Gauge,
  Lightbulb,
  ShieldCheck,
} from 'lucide-react';
import type { SimulationResults, SimulationConfig } from '../engine/types';

interface InsightsPanelProps {
  config: SimulationConfig;
  results: SimulationResults | null;
}

export function InsightsPanel({ config, results }: InsightsPanelProps) {
  const queueCapacity = config.queuePolicy === 'priority' ? config.queueCapacity * 2 : config.queueCapacity;
  const queuePressure = results
    ? queueCapacity > 0
      ? Math.min(100, (results.peakQueueOccupancy / queueCapacity) * 100)
      : results.totalPacketsDropped > 0 ? 100 : 0
    : 0;
  const deliveryRate = results && results.totalPacketsSent > 0
    ? (results.totalPacketsDelivered / results.totalPacketsSent) * 100
    : 0;
  const controlAdjustments = results?.events.filter(event => event.type === 'control_adjustment').length ?? 0;
  const severity = !results ? 'ready'
    : results.packetLossPercent > 10 || (results.congestionDetected && results.totalPacketsDropped > 0) ? 'critical'
      : results.congestionDetected || queuePressure >= 70 ? 'warning' : 'none';
  const severityLabel = severity === 'ready' ? 'Ready'
    : severity === 'critical' ? 'Congested'
      : severity === 'warning' ? 'Warning' : 'Normal';
  const recommendation = getRecommendation(config, results, queuePressure, controlAdjustments);
  const alertTitle = !results ? 'Network health monitor ready'
    : severity === 'critical' ? 'Network congestion detected'
      : severity === 'warning' ? 'Traffic pressure is elevated'
        : 'Network operating normally';
  const alertMessage = !results
    ? 'Run a simulation to inspect queue pressure, packet delivery and congestion behavior.'
    : results.totalPacketsDropped > 0
      ? `${results.totalPacketsDropped.toLocaleString()} packets were dropped during this run. Review offered load, link capacity and queue policy.`
      : results.congestionDetected
        ? 'The queue reached a high occupancy level. Review the time-series chart for the congestion window.'
        : 'No packet drops were recorded in this run. Try a bursty workload or increase offered traffic to test the bottleneck.';

  return (
    <section className="insights-panel congestion-monitor-panel">
      <div className="health-panel-heading">
        <div>
          <p className="eyebrow">NETWORK HEALTH</p>
          <h2>Congestion Monitor</h2>
        </div>
        <span className={`severity-badge ${severity}`}>{severityLabel}</span>
      </div>

      <div className={`monitor-alert ${severity}`}>
        <div className="monitor-alert-icon">{severity === 'critical' ? <AlertTriangle size={16} /> : severity === 'warning' ? <Activity size={16} /> : <CheckCircle2 size={16} />}</div>
        <div className="monitor-alert-copy"><strong>{alertTitle}</strong><p>{alertMessage}</p></div>
      </div>

      <div className="queue-pressure-heading"><span><Gauge size={13} /> Queue pressure</span><strong>{results ? `${queuePressure.toFixed(0)}%` : '—'}</strong></div>
      <div className="health-progress-track monitor-progress"><div className={`health-progress-fill ${queuePressure >= 80 ? 'danger' : queuePressure >= 50 ? 'warning' : ''}`} style={{ width: `${results ? queuePressure : 0}%` }} /></div>
      <div className="monitor-stat-grid">
        <div className="monitor-stat"><span>Packets generated</span><strong>{results ? results.totalPacketsSent.toLocaleString() : '—'}</strong></div>
        <div className="monitor-stat"><span>Packets delivered</span><strong>{results ? results.totalPacketsDelivered.toLocaleString() : '—'}</strong></div>
        <div className="monitor-stat"><span>Simulation time</span><strong>{results ? `${(results.measurementIntervalMs / 1000).toFixed(2)} s` : '—'}</strong></div>
      </div>

      <div className="smart-recommendation monitor-recommendation">
        <div className="recommendation-icon"><ShieldCheck size={16} /></div>
        <div className="recommendation-copy">
          <span className="recommendation-eyebrow"><Lightbulb size={11} /> SMART RECOMMENDATION</span>
          <strong>{recommendation.title}</strong>
          <p>{recommendation.message}</p>
          {results && config.automaticCongestionControl && (
            <small className="controller-note">Feedback adjustments recorded: {controlAdjustments}. This educational controller is not TCP Reno/CUBIC/BBR.</small>
          )}
        </div>
      </div>

      <div className="monitor-summary">
        <p className="eyebrow">PERFORMANCE SUMMARY</p>
        <div className="monitor-summary-row"><span>Packets dropped</span><strong className={results && results.totalPacketsDropped > 0 ? 'text-danger' : ''}>{results ? results.totalPacketsDropped.toLocaleString() : '—'}</strong></div>
        <div className="monitor-summary-row"><span>Successful delivery</span><strong>{results ? `${deliveryRate.toFixed(1)}%` : '—'}</strong></div>
        {results && (
          <div className="insight-tags">
            {results.bufferSaturated && <span className="insight-tag text-danger">● Buffer Saturated</span>}
            {results.totalPacketsDropped > 0 && <span className="insight-tag text-danger">● Packet Drops Observed</span>}
            {results.offeredLoadMbps > config.bottleneckBandwidthMbps && <span className="insight-tag text-warning">⚡ Demand { (results.offeredLoadMbps / config.bottleneckBandwidthMbps).toFixed(1) }× link capacity</span>}
            {config.automaticCongestionControl && <span className="insight-tag text-accent">↘ Feedback enabled</span>}
          </div>
        )}
      </div>
    </section>
  );
}

function getRecommendation(
  config: SimulationConfig,
  results: SimulationResults | null,
  queuePressure: number,
  controlAdjustments: number,
): { title: string; message: string } {
  if (!results) return { title: 'Ready to analyze the network', message: 'Run a scenario to receive a recommendation based on actual queue, delivery and packet-drop measurements.' };
  if (config.automaticCongestionControl && controlAdjustments > 0) {
    return { title: 'Feedback control reacted to congestion', message: 'The rule-based controller adjusted future packet arrival gaps after high queue pressure or drops. Compare with the same scenario with feedback disabled.' };
  }
  if (results.totalPacketsDropped > 0 && results.offeredLoadMbps > config.bottleneckBandwidthMbps) {
    return { title: 'Relieve the bottleneck', message: 'Offered load exceeds link capacity and drops were recorded. Try increasing bandwidth or reducing sender rates, then rerun the same workload.' };
  }
  if (results.totalPacketsDropped > 0) {
    return { title: 'Investigate buffer overflow', message: 'Packets were dropped. Check traffic burstiness, queue capacity and whether a different queue policy changes per-flow outcomes.' };
  }
  if (queuePressure >= 70) {
    return { title: 'Monitor queue pressure', message: 'The waiting queue reached an elevated level. Test a higher-capacity link or a different traffic profile and compare delay.' };
  }
  if (results.avgEndToEndDelayMs > Math.max(config.propagationDelayMs * 3, config.propagationDelayMs + 5)) {
    return { title: 'Investigate queueing delay', message: 'Average delay is above the propagation baseline. Review queue occupancy and compare the same traffic under a higher-capacity link.' };
  }
  return { title: 'Network operating within modeled limits', message: 'No packet drops were observed in this run. Increase offered traffic or choose bursty traffic to test the bottleneck near capacity.' };
}
