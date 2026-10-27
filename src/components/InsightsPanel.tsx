import { useState } from 'react';
import { ChevronDown, Lightbulb } from 'lucide-react';
import type { SimulationResults, SimulationConfig } from '../engine/types';

interface InsightsPanelProps {
  config: SimulationConfig;
  results: SimulationResults | null;
}

export function InsightsPanel({ config, results }: InsightsPanelProps) {
  const [expanded, setExpanded] = useState(true);

  if (!results) return null;

  const insights = generateInsights(config, results);
  if (insights.length === 0 && !results.congestionDetected) return null;

  const severity = results.packetLossPercent > 10
    ? 'critical'
    : results.packetLossPercent > 0
      ? 'warning'
      : 'none';

  const severityLabel = severity === 'critical'
    ? 'Severe Congestion'
    : severity === 'warning'
      ? 'Moderate Congestion'
      : 'No Congestion';

  return (
    <div className="insights-panel">
      <div className="insights-header" onClick={() => setExpanded(!expanded)}>
        <div className="insights-title">
          <Lightbulb size={16} style={{ color: 'var(--warning)' }} />
          <span>Congestion Insights</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`severity-badge ${severity}`}>{severityLabel}</span>
          <ChevronDown size={16} className={`chevron${expanded ? ' open' : ''}`} />
        </div>
      </div>

      {expanded && (
        <div className="insights-body">
          {insights.map((insight, i) => (
            <p key={i} className="insight-text" style={{ marginBottom: 8 }}>
              {insight}
            </p>
          ))}

          <div className="insight-tags">
            {results.bufferSaturated && (
              <span className="insight-tag" style={{ color: 'var(--danger)' }}>
                ● Buffer Saturated
              </span>
            )}
            {results.totalPacketsDropped > 0 && (
              <span className="insight-tag" style={{ color: 'var(--danger)' }}>
                ⛔ Tail-Drop Active
              </span>
            )}
            {results.offeredLoadMbps > config.bottleneckBandwidthMbps && (
              <span className="insight-tag" style={{ color: 'var(--warning)' }}>
                ⚡ Overload Ratio: {(results.offeredLoadMbps / config.bottleneckBandwidthMbps).toFixed(1)}x
              </span>
            )}
            {!results.congestionDetected && (
              <span className="insight-tag" style={{ color: 'var(--success)' }}>
                ✓ No Drops
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function generateInsights(config: SimulationConfig, results: SimulationResults): string[] {
  const insights: string[] = [];

  // Only report facts from actual simulation data
  if (results.offeredLoadMbps > config.bottleneckBandwidthMbps && results.totalPacketsDropped > 0) {
    insights.push(
      `Offered load (${results.offeredLoadMbps.toFixed(1)} Mbps) continuously exceeds bottleneck link capacity (${config.bottleneckBandwidthMbps} Mbps). ` +
      `The ${config.queueCapacity}-packet buffer became full` +
      (results.bufferSaturationTimeMs !== null
        ? ` at t=${(results.bufferSaturationTimeMs / 1000).toFixed(2)}s`
        : '') +
      `, causing sustained Drop-Tail packet drops. ` +
      `Increasing bottleneck bandwidth to ≥${results.offeredLoadMbps.toFixed(0)} Mbps would eliminate this bottleneck.`
    );
  }

  if (results.totalPacketsDropped > 0 && results.offeredLoadMbps <= config.bottleneckBandwidthMbps) {
    insights.push(
      `Although the aggregate offered load (${results.offeredLoadMbps.toFixed(1)} Mbps) is within link capacity, ` +
      `transient burst patterns caused ${results.totalPacketsDropped} packet drops due to temporary queue overflow.`
    );
  }

  if (results.avgEndToEndDelayMs > config.propagationDelayMs * 3 && results.totalPacketsDropped === 0) {
    insights.push(
      `No packets were dropped, but average end-to-end delay (${results.avgEndToEndDelayMs.toFixed(1)}ms) ` +
      `is significantly above the propagation delay (${config.propagationDelayMs}ms), ` +
      `indicating substantial queueing delay. Buffer bloat may be occurring.`
    );
  }

  if (!results.congestionDetected && results.totalPacketsDropped === 0) {
    insights.push(
      `The network is operating within capacity. No packet drops or buffer saturation detected. ` +
      `Delivered throughput: ${results.deliveredThroughputMbps.toFixed(2)} Mbps.`
    );
  }

  return insights;
}
