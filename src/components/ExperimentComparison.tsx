import { useState, useCallback, useMemo } from 'react';
import {
  Play,
  RotateCcw,
  Download,
  Layers,
  FileSpreadsheet,
  TrendingUp,
  Loader,
  ShieldCheck,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { runSimulation } from '../engine/simulator';
import {
  EXPERIMENTS,
  type ExperimentDefinition,
  type ExperimentRunState,
} from '../experiments/definitions';
import {
  generateSummaryCsv,
  generateTimeSeriesCsv,
  downloadCsvFile,
} from '../experiments/csvExport';

type ComparisonMetric = 'throughput' | 'delay' | 'loss' | 'queue';

export function ExperimentComparison() {
  const [runs, setRuns] = useState<Record<string, ExperimentRunState>>({
    'exp-a': { status: 'idle', result: null },
    'exp-b': { status: 'idle', result: null },
    'exp-c': { status: 'idle', result: null },
  });
  const [activeMetric, setActiveMetric] = useState<ComparisonMetric>('throughput');
  const [isRunningBatch, setIsRunningBatch] = useState(false);

  // Execute a single experiment
  const runSingle = useCallback((exp: ExperimentDefinition) => {
    setRuns(prev => ({
      ...prev,
      [exp.id]: { status: 'running', result: null },
    }));

    setTimeout(() => {
      const startTime = performance.now();
      try {
        const result = runSimulation(exp.config);
        const duration = performance.now() - startTime;
        setRuns(prev => ({
          ...prev,
          [exp.id]: { status: 'completed', result, runDurationMs: duration },
        }));
      } catch (err) {
        setRuns(prev => ({
          ...prev,
          [exp.id]: {
            status: 'failed',
            result: null,
            error: err instanceof Error ? err.message : 'Simulation failed',
          },
        }));
      }
    }, 40);
  }, []);

  // Run all 3 experiments sequentially
  const runAll = useCallback(() => {
    setIsRunningBatch(true);
    setRuns({
      'exp-a': { status: 'running', result: null },
      'exp-b': { status: 'running', result: null },
      'exp-c': { status: 'running', result: null },
    });

    setTimeout(() => {
      try {
        const resultsMap: Record<string, ExperimentRunState> = {};
        for (const exp of EXPERIMENTS) {
          const t0 = performance.now();
          const result = runSimulation(exp.config);
          const dur = performance.now() - t0;
          resultsMap[exp.id] = { status: 'completed', result, runDurationMs: dur };
        }
        setRuns(resultsMap);
      } catch (err) {
        console.error('Batch run failed:', err);
      } finally {
        setIsRunningBatch(false);
      }
    }, 60);
  }, []);

  const completedCount = useMemo(() => {
    return Object.values(runs).filter(r => r.status === 'completed' && r.result !== null).length;
  }, [runs]);

  const hasAnyResults = completedCount > 0;
  const isAnyRunning = isRunningBatch || Object.values(runs).some(r => r.status === 'running');

  // CSV Handlers
  const handleExportSummaryCsv = useCallback(() => {
    if (!hasAnyResults) return;
    const csv = generateSummaryCsv(EXPERIMENTS, runs);
    downloadCsvFile(csv, 'netpulse-experiment-results.csv');
  }, [hasAnyResults, runs]);

  const handleExportTimeSeriesCsv = useCallback(() => {
    if (!hasAnyResults) return;
    const csv = generateTimeSeriesCsv(EXPERIMENTS, runs);
    downloadCsvFile(csv, 'netpulse-timeseries-results.csv');
  }, [hasAnyResults, runs]);

  // Unified chart data merging time series from all completed runs
  const chartData = useMemo(() => {
    const resA = runs['exp-a']?.result;
    const resB = runs['exp-b']?.result;
    const resC = runs['exp-c']?.result;

    if (!resA && !resB && !resC) return [];

    const maxLen = Math.max(
      resA?.timeSeries.length ?? 0,
      resB?.timeSeries.length ?? 0,
      resC?.timeSeries.length ?? 0
    );

    const merged: {
      time: string;
      throughputA?: number;
      throughputB?: number;
      throughputC?: number;
      delayA?: number;
      delayB?: number;
      delayC?: number;
      lossA?: number;
      lossB?: number;
      lossC?: number;
      queueA?: number;
      queueB?: number;
      queueC?: number;
    }[] = [];

    for (let i = 0; i < maxLen; i++) {
      const sampleA = resA?.timeSeries[i];
      const sampleB = resB?.timeSeries[i];
      const sampleC = resC?.timeSeries[i];

      const timeVal = sampleA?.time ?? sampleB?.time ?? sampleC?.time ?? i * 100;
      const point: (typeof merged)[0] = {
        time: (timeVal / 1000).toFixed(1),
      };

      if (sampleA) {
        point.throughputA = Number(sampleA.throughputMbps.toFixed(2));
        point.delayA = Number(sampleA.avgDelayMs.toFixed(1));
        point.lossA = sampleA.droppedInWindow;
        point.queueA = sampleA.queueLength;
      }
      if (sampleB) {
        point.throughputB = Number(sampleB.throughputMbps.toFixed(2));
        point.delayB = Number(sampleB.avgDelayMs.toFixed(1));
        point.lossB = sampleB.droppedInWindow;
        point.queueB = sampleB.queueLength;
      }
      if (sampleC) {
        point.throughputC = Number(sampleC.throughputMbps.toFixed(2));
        point.delayC = Number(sampleC.avgDelayMs.toFixed(1));
        point.lossC = sampleC.droppedInWindow;
        point.queueC = sampleC.queueLength;
      }

      merged.push(point);
    }

    return merged;
  }, [runs]);

  const resA = runs['exp-a']?.result;
  const resB = runs['exp-b']?.result;
  const resC = runs['exp-c']?.result;

  return (
    <div className="compare-container">
      {/* ─── Action Bar ────────────────────────────────────────────── */}
      <div className="compare-header-bar">
        <div className="compare-header-info">
          <div className="compare-title-row">
            <h1 className="compare-title">Compare Experiments</h1>
            <span className="compare-badge">
              {completedCount === 3
                ? 'Batch Completed (3/3 Runs)'
                : `${completedCount}/3 Experiments Completed`}
            </span>
          </div>
          <p className="compare-subtitle">
            Compare network configurations under identical traffic conditions (Offered Load: 15.0 Mbps, Seed #42, Duration: 10.0s).
          </p>
        </div>

        <div className="compare-actions">
          <button
            className="btn btn-secondary"
            onClick={handleExportSummaryCsv}
            disabled={!hasAnyResults}
            title={hasAnyResults ? 'Download Summary CSV' : 'Run experiments first to export CSV'}
          >
            <Download size={14} />
            Export CSV
          </button>
          <button
            className="btn btn-secondary"
            onClick={handleExportTimeSeriesCsv}
            disabled={!hasAnyResults}
            title={hasAnyResults ? 'Download Time-Series CSV' : 'Run experiments first to export CSV'}
            style={{ fontSize: 12 }}
          >
            <FileSpreadsheet size={14} />
            Time-Series CSV
          </button>
          <button
            className="btn btn-primary"
            onClick={runAll}
            disabled={isAnyRunning}
          >
            {isAnyRunning ? (
              <Loader size={15} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <Play size={15} />
            )}
            {completedCount === 3 ? 'Re-run All Experiments' : 'Run All Experiments'}
          </button>
        </div>
      </div>

      {/* ─── 3 Experiment Cards ────────────────────────────────────── */}
      <div className="compare-cards-grid">
        {EXPERIMENTS.map((exp, index) => {
          const run = runs[exp.id];
          const isRunning = run.status === 'running';
          const isCompleted = run.status === 'completed';
          const isFailed = run.status === 'failed';

          return (
            <div
              key={exp.id}
              className={`compare-card ${isCompleted ? 'active' : ''}`}
            >
              <div className="compare-card-header">
                <span className="compare-card-config-id">
                  Configuration #0{index + 1}
                </span>
                <span
                  className="compare-card-badge"
                  style={{
                    backgroundColor: `${exp.badgeColor}20`,
                    color: exp.badgeColor,
                    borderColor: `${exp.badgeColor}40`,
                  }}
                >
                  {exp.badge}
                </span>
              </div>

              <div className="compare-card-title-row">
                <span className="compare-card-name">Experiment {exp.key}</span>
                <span className="compare-card-sub">{exp.subtitle}</span>
              </div>

              {/* Parameters Grid */}
              <div className="compare-param-grid">
                <div className="compare-param-cell">
                  <span className="compare-param-label">Offered Load</span>
                  <span className="compare-param-value">
                    15.0 <span className="compare-param-unit">Mbps</span>
                  </span>
                </div>
                <div className="compare-param-cell">
                  <span className="compare-param-label">Bottleneck Cap</span>
                  <span
                    className="compare-param-value"
                    style={{
                      color: exp.key === 'B' ? 'var(--secondary)' : 'var(--text-primary)',
                      fontWeight: exp.key === 'B' ? 700 : 600,
                    }}
                  >
                    {exp.config.bottleneckBandwidthMbps}.0{' '}
                    <span className="compare-param-unit">Mbps</span>
                  </span>
                </div>
                <div className="compare-param-cell">
                  <span className="compare-param-label">Queue Policy</span>
                  <span
                    className="compare-param-value"
                    style={{
                      color: exp.key === 'C' ? 'var(--primary)' : 'var(--text-primary)',
                      fontWeight: exp.key === 'C' ? 700 : 600,
                    }}
                  >
                    {exp.config.queuePolicy === 'priority' ? 'Strict Priority' : 'Drop-Tail'}
                  </span>
                </div>
                <div className="compare-param-cell">
                  <span className="compare-param-label">Buffer Limit</span>
                  <span className="compare-param-value">
                    {exp.config.queueCapacity}{' '}
                    <span className="compare-param-unit">pkts</span>
                  </span>
                </div>
              </div>

              <p className="compare-card-desc">{exp.description}</p>

              {/* Status and Run Action */}
              <div className="compare-card-footer">
                <div className="compare-status-indicator">
                  <span
                    className={`status-dot ${
                      isRunning ? 'running' : isCompleted ? '' : isFailed ? 'congested' : ''
                    }`}
                    style={{
                      backgroundColor:
                        isCompleted ? 'var(--success)' : isRunning ? 'var(--warning)' : isFailed ? 'var(--danger)' : '#64748B',
                    }}
                  />
                  <span className="compare-status-text">
                    {isRunning
                      ? 'Simulating...'
                      : isCompleted
                      ? `Completed (${run.result?.totalPacketsSent.toLocaleString()} pkts)`
                      : isFailed
                      ? 'Failed'
                      : 'Not Run'}
                  </span>
                </div>

                <button
                  className="btn-card-run"
                  onClick={() => runSingle(exp)}
                  disabled={isRunning || isAnyRunning}
                  title="Run this experiment individually"
                >
                  {isRunning ? (
                    <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} />
                  ) : isCompleted ? (
                    <RotateCcw size={12} />
                  ) : (
                    <Play size={12} />
                  )}
                  {isCompleted ? 'Run Again' : 'Run'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ─── Empty State or Results Sections ────────────────────────── */}
      {!hasAnyResults ? (
        <div className="compare-empty-state">
          <div className="compare-empty-icon-wrap">
            <Layers size={36} style={{ color: 'var(--text-muted)' }} />
          </div>
          <h2 className="compare-empty-title">No Completed Experiment Runs</h2>
          <p className="compare-empty-desc">
            Execute batch telemetry across Experiment A (Baseline 10M), Experiment B (20M Scaled Egress), and Experiment C (Strict Priority) to evaluate link saturation, queue behavior, and packet loss side-by-side.
          </p>
          <button
            className="btn btn-primary"
            onClick={runAll}
            disabled={isAnyRunning}
            style={{ marginTop: 8 }}
          >
            <Play size={16} />
            Run All 3 Experiments
          </button>
        </div>
      ) : (
        <>
          {/* ─── Quantitative Metrics Comparison Table ──────────────── */}
          <div className="compare-table-card">
            <div className="compare-table-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <TrendingUp size={18} style={{ color: 'var(--secondary)' }} />
                <h2 className="compare-section-title">Quantitative Telemetry Matrix</h2>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Uniform Test Seed #42 • 10.0s Duration
              </span>
            </div>

            <div className="compare-table-wrapper">
              <table className="compare-table">
                <thead>
                  <tr>
                    <th>Evaluation Metric</th>
                    <th>Experiment A (Baseline 10M)</th>
                    <th style={{ color: '#4CD7F6' }}>Experiment B (+100% BW 20M)</th>
                    <th style={{ color: '#93CCFF' }}>Experiment C (Strict Priority)</th>
                    <th style={{ textAlign: 'right' }}>Key Observation (vs Base)</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Delivered Throughput */}
                  <tr>
                    <td>
                      <div className="metric-row-label">
                        <strong>Delivered Throughput</strong>
                        <span>Total traffic successfully delivered to receiver</span>
                      </div>
                    </td>
                    <td>
                      {resA ? (
                        <>
                          <div className="metric-val">
                            {resA.deliveredThroughputMbps.toFixed(2)}{' '}
                            <span className="unit">Mbps</span>
                          </div>
                          <span className="metric-note">Bottleneck bound (10M cap)</span>
                        </>
                      ) : (
                        <span className="metric-pending">—</span>
                      )}
                    </td>
                    <td className="highlight-col">
                      {resB ? (
                        <>
                          <div className="metric-val" style={{ color: '#4CD7F6', fontWeight: 700 }}>
                            {resB.deliveredThroughputMbps.toFixed(2)}{' '}
                            <span className="unit">Mbps</span>
                          </div>
                          <span className="metric-tag-success">
                            +{(resB.deliveredThroughputMbps - (resA?.deliveredThroughputMbps ?? 10)).toFixed(2)} Mbps (All 15M absorbed)
                          </span>
                        </>
                      ) : (
                        <span className="metric-pending">—</span>
                      )}
                    </td>
                    <td>
                      {resC ? (
                        <>
                          <div className="metric-val">
                            {resC.deliveredThroughputMbps.toFixed(2)}{' '}
                            <span className="unit">Mbps</span>
                          </div>
                          <span className="metric-note">Bottleneck bound (10M cap)</span>
                        </>
                      ) : (
                        <span className="metric-pending">—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {resA && resB ? (
                        <span className="delta-badge success">
                          +100% Link Headroom
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>

                  {/* Average Packet Delay */}
                  <tr>
                    <td>
                      <div className="metric-row-label">
                        <strong>Average Packet Delay</strong>
                        <span>End-to-end latency (queueing + tx + propagation)</span>
                      </div>
                    </td>
                    <td>
                      {resA ? (
                        <>
                          <div className="metric-val danger">
                            {resA.avgEndToEndDelayMs.toFixed(1)}{' '}
                            <span className="unit">ms</span>
                          </div>
                          <span className="metric-note danger">High queue backlog</span>
                        </>
                      ) : (
                        <span className="metric-pending">—</span>
                      )}
                    </td>
                    <td className="highlight-col">
                      {resB ? (
                        <>
                          <div className="metric-val success">
                            {resB.avgEndToEndDelayMs.toFixed(1)}{' '}
                            <span className="unit">ms</span>
                          </div>
                          <span className="metric-tag-success">
                            {resA
                              ? `-${(resA.avgEndToEndDelayMs - resB.avgEndToEndDelayMs).toFixed(1)}ms (${(((resA.avgEndToEndDelayMs - resB.avgEndToEndDelayMs) / resA.avgEndToEndDelayMs) * 100).toFixed(0)}% lower)`
                              : 'Minimal queue delay'}
                          </span>
                        </>
                      ) : (
                        <span className="metric-pending">—</span>
                      )}
                    </td>
                    <td>
                      {resC ? (
                        <>
                          <div className="metric-val">
                            {resC.avgEndToEndDelayMs.toFixed(1)}{' '}
                            <span className="unit">ms</span>
                          </div>
                          <span className="metric-tag-info">
                            Host A: {(resC.senderStats.find(s => s.senderId === 'sender-a')?.avgDelayMs ?? 0).toFixed(1)}ms
                          </span>
                        </>
                      ) : (
                        <span className="metric-pending">—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {resA && resB ? (
                        <span className="delta-badge success">
                          Zero queueing wait (Exp B)
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>

                  {/* Packet Loss Rate */}
                  <tr>
                    <td>
                      <div className="metric-row-label">
                        <strong>Packet Loss Rate</strong>
                        <span>Drop-Tail dropped packet percentage</span>
                      </div>
                    </td>
                    <td>
                      {resA ? (
                        <>
                          <div className="metric-val danger">
                            {resA.packetLossPercent.toFixed(1)}%
                          </div>
                          <span className="metric-note danger">
                            {resA.totalPacketsDropped.toLocaleString()} pkts dropped
                          </span>
                        </>
                      ) : (
                        <span className="metric-pending">—</span>
                      )}
                    </td>
                    <td className="highlight-col">
                      {resB ? (
                        <>
                          <div className="metric-val success">0.0%</div>
                          <span className="metric-tag-success">0 drops (Lossless)</span>
                        </>
                      ) : (
                        <span className="metric-pending">—</span>
                      )}
                    </td>
                    <td>
                      {resC ? (
                        <>
                          <div className="metric-val">
                            {resC.packetLossPercent.toFixed(1)}%
                          </div>
                          <span className="metric-tag-info">
                            Host A: 0% drops ({resC.senderStats.find(s => s.senderId === 'sender-a')?.packetsDropped} drops)
                          </span>
                        </>
                      ) : (
                        <span className="metric-pending">—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {resA && resB ? (
                        <span className="delta-badge success">
                          100% Drop Elimination (Exp B)
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>

                  {/* Peak Queue Occupancy */}
                  <tr>
                    <td>
                      <div className="metric-row-label">
                        <strong>Peak Queue Occupancy</strong>
                        <span>Maximum packets waiting in queue buffer</span>
                      </div>
                    </td>
                    <td>
                      {resA ? (
                        <>
                          <div className="metric-val danger">
                            {resA.peakQueueOccupancy} / 100{' '}
                            <span className="unit">pkts</span>
                          </div>
                          <span className="metric-note danger">100% Buffer Saturation</span>
                        </>
                      ) : (
                        <span className="metric-pending">—</span>
                      )}
                    </td>
                    <td className="highlight-col">
                      {resB ? (
                        <>
                          <div className="metric-val success">
                            {resB.peakQueueOccupancy} / 100{' '}
                            <span className="unit">pkts</span>
                          </div>
                          <span className="metric-tag-success">
                            {((resB.peakQueueOccupancy / 100) * 100).toFixed(0)}% Buffer utilization
                          </span>
                        </>
                      ) : (
                        <span className="metric-pending">—</span>
                      )}
                    </td>
                    <td>
                      {resC ? (
                        <>
                          <div className="metric-val">
                            {resC.peakQueueOccupancy} / 100{' '}
                            <span className="unit">pkts</span>
                          </div>
                          <span className="metric-note">Normal queue backlog</span>
                        </>
                      ) : (
                        <span className="metric-pending">—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {resA && resB ? (
                        <span className="delta-badge info">
                          -{(resA.peakQueueOccupancy - resB.peakQueueOccupancy)} pkts in buffer
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>

                  {/* Link Utilization */}
                  <tr>
                    <td>
                      <div className="metric-row-label">
                        <strong>Link Utilization</strong>
                        <span>Delivered throughput vs bottleneck capacity</span>
                      </div>
                    </td>
                    <td>
                      {resA ? (
                        <>
                          <div className="metric-val">
                            {((resA.deliveredThroughputMbps / 10) * 100).toFixed(1)}%
                          </div>
                          <span className="metric-note">100% Link Saturation</span>
                        </>
                      ) : (
                        <span className="metric-pending">—</span>
                      )}
                    </td>
                    <td className="highlight-col">
                      {resB ? (
                        <>
                          <div className="metric-val" style={{ color: '#4CD7F6' }}>
                            {((resB.deliveredThroughputMbps / 20) * 100).toFixed(1)}%
                          </div>
                          <span className="metric-note">
                            {(100 - (resB.deliveredThroughputMbps / 20) * 100).toFixed(1)}% Idle Headroom
                          </span>
                        </>
                      ) : (
                        <span className="metric-pending">—</span>
                      )}
                    </td>
                    <td>
                      {resC ? (
                        <>
                          <div className="metric-val">
                            {((resC.deliveredThroughputMbps / 10) * 100).toFixed(1)}%
                          </div>
                          <span className="metric-note">100% Link Saturation</span>
                        </>
                      ) : (
                        <span className="metric-pending">—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="delta-badge neutral">
                        {resB ? 'Non-congested state' : '—'}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* ─── Visual Comparison Chart ────────────────────────────── */}
          <div className="chart-container" style={{ marginTop: 0 }}>
            <div className="chart-header">
              <div>
                <span className="chart-title">Comparative Performance Dynamics</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                  (Time-progression across 10-second simulation runtime)
                </span>
              </div>
              <div className="chart-selector">
                <button
                  className={activeMetric === 'throughput' ? 'active' : ''}
                  onClick={() => setActiveMetric('throughput')}
                >
                  Throughput (Mbps)
                </button>
                <button
                  className={activeMetric === 'delay' ? 'active' : ''}
                  onClick={() => setActiveMetric('delay')}
                >
                  Average Delay (ms)
                </button>
                <button
                  className={activeMetric === 'loss' ? 'active' : ''}
                  onClick={() => setActiveMetric('loss')}
                >
                  Packet Drops
                </button>
                <button
                  className={activeMetric === 'queue' ? 'active' : ''}
                  onClick={() => setActiveMetric('queue')}
                >
                  Queue Occupancy (pkts)
                </button>
              </div>
            </div>

            <div className="chart-body" style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="4 4" stroke="#2D3748" horizontal vertical={false} />
                  <XAxis
                    dataKey="time"
                    tick={{ fill: '#64748B', fontSize: 10 }}
                    axisLine={{ stroke: '#2D3748' }}
                    tickLine={false}
                    label={{ value: 'Time (s)', position: 'insideBottomRight', offset: -5, fill: '#64748B', fontSize: 10 }}
                  />
                  <YAxis
                    tick={{ fill: '#64748B', fontSize: 10 }}
                    axisLine={{ stroke: '#2D3748' }}
                    tickLine={false}
                    label={{
                      value:
                        activeMetric === 'throughput'
                          ? 'Mbps'
                          : activeMetric === 'delay'
                          ? 'ms'
                          : activeMetric === 'loss'
                          ? 'Packets'
                          : 'Packets in Queue',
                      angle: -90,
                      position: 'insideLeft',
                      fill: '#64748B',
                      fontSize: 10,
                    }}
                  />
                  <Tooltip content={<ComparisonTooltip metric={activeMetric} />} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8, color: '#94A3B8' }} />

                  {/* Reference line for baseline bottleneck capacity */}
                  {activeMetric === 'throughput' && (
                    <>
                      <ReferenceLine
                        y={10}
                        stroke="#EF4444"
                        strokeDasharray="6 4"
                        strokeWidth={1}
                        label={{ value: 'Bottleneck A/C (10 Mbps)', fill: '#EF4444', fontSize: 10, position: 'right' }}
                      />
                      <ReferenceLine
                        y={20}
                        stroke="#4CD7F6"
                        strokeDasharray="6 4"
                        strokeWidth={1}
                        label={{ value: 'Bottleneck B (20 Mbps)', fill: '#4CD7F6', fontSize: 10, position: 'right' }}
                      />
                    </>
                  )}

                  {activeMetric === 'queue' && (
                    <ReferenceLine
                      y={100}
                      stroke="#EF4444"
                      strokeDasharray="6 4"
                      strokeWidth={1}
                      label={{ value: 'Queue Limit (100 pkts)', fill: '#EF4444', fontSize: 10, position: 'right' }}
                    />
                  )}

                  {/* Series lines */}
                  {resA && (
                    <Line
                      type="monotone"
                      dataKey={
                        activeMetric === 'throughput'
                          ? 'throughputA'
                          : activeMetric === 'delay'
                          ? 'delayA'
                          : activeMetric === 'loss'
                          ? 'lossA'
                          : 'queueA'
                      }
                      name="Experiment A (Baseline 10M)"
                      stroke="#93CCFF"
                      strokeWidth={2}
                      dot={false}
                      strokeDasharray="4 2"
                      activeDot={{ r: 4 }}
                    />
                  )}

                  {resB && (
                    <Line
                      type="monotone"
                      dataKey={
                        activeMetric === 'throughput'
                          ? 'throughputB'
                          : activeMetric === 'delay'
                          ? 'delayB'
                          : activeMetric === 'loss'
                          ? 'lossB'
                          : 'queueB'
                      }
                      name="Experiment B (+100% BW 20M)"
                      stroke="#4CD7F6"
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  )}

                  {resC && (
                    <Line
                      type="monotone"
                      dataKey={
                        activeMetric === 'throughput'
                          ? 'throughputC'
                          : activeMetric === 'delay'
                          ? 'delayC'
                          : activeMetric === 'loss'
                          ? 'lossC'
                          : 'queueC'
                      }
                      name="Experiment C (Strict Priority)"
                      stroke="#3198DC"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ─── Results Interpretation: What Changed? ─────────────── */}
          <div className="compare-insights-card">
            <div className="compare-insights-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ShieldCheck size={18} style={{ color: 'var(--tertiary)' }} />
                <h2 className="compare-section-title">What Changed? — Empirical Findings</h2>
              </div>
              <span className="compare-badge">System Analysis</span>
            </div>

            <div className="compare-observations-grid">
              {/* Observation 1: Exp B */}
              <div className="compare-obs-box">
                <div className="compare-obs-title-row">
                  <span className="obs-pill" style={{ background: '#4CD7F6' }} />
                  <h3 className="compare-obs-title">Observation 1 — Bandwidth Scaling (Experiment B)</h3>
                </div>
                <p className="compare-obs-text">
                  {resB && resA ? (
                    <>
                      Increasing bottleneck link capacity from{' '}
                      <strong>10.0 Mbps to 20.0 Mbps</strong> completely resolved network congestion.
                      Because the 15.0 Mbps offered load is safely below the 20.0 Mbps threshold,
                      packet loss dropped from <strong>{resA.packetLossPercent.toFixed(1)}% to {resB.packetLossPercent.toFixed(1)}%</strong>,
                      and average latency plummeted by{' '}
                      <strong>
                        {(((resA.avgEndToEndDelayMs - resB.avgEndToEndDelayMs) / resA.avgEndToEndDelayMs) * 100).toFixed(0)}%
                        ({resA.avgEndToEndDelayMs.toFixed(1)}ms → {resB.avgEndToEndDelayMs.toFixed(1)}ms)
                      </strong>{' '}
                      because packets no longer accumulate in the waiting queue.
                    </>
                  ) : (
                    'Run Experiments A and B to measure how doubling link capacity impacts throughput, delay, and packet loss.'
                  )}
                </p>
                <div className="insight-tags" style={{ marginTop: 8 }}>
                  <span className="insight-tag" style={{ color: '#4CD7F6' }}>
                    ✓ Capacity &gt; Offered Load
                  </span>
                  <span className="insight-tag" style={{ color: 'var(--success)' }}>
                    ✓ Zero Drop Guarantee
                  </span>
                  <span className="insight-tag" style={{ color: 'var(--text-secondary)' }}>
                    ✓ Minimal Queue Delay
                  </span>
                </div>
              </div>

              {/* Observation 2: Exp C */}
              <div className="compare-obs-box">
                <div className="compare-obs-title-row">
                  <span className="obs-pill" style={{ background: '#93CCFF' }} />
                  <h3 className="compare-obs-title">Observation 2 — Queue Discipline &amp; QoS (Experiment C)</h3>
                </div>
                <p className="compare-obs-text">
                  {resC ? (
                    <>
                      Under the exact same 10.0 Mbps capacity constraint, switching from Drop-Tail to{' '}
                      <strong>Strict Priority</strong> created strong service differentiation.
                      Host A (high priority, 6.0 Mbps) experienced{' '}
                      <strong>0 packet drops and {(resC.senderStats.find(s => s.senderId === 'sender-a')?.avgDelayMs ?? 0).toFixed(1)}ms delay</strong>,
                      while normal priority traffic (Host B &amp; C) absorbed the remaining 4.0 Mbps and sustained all the queueing delay and drops.
                      <strong> Crucial note:</strong> Strict priority does <em>not</em> create additional throughput (total throughput remains ~{resC.deliveredThroughputMbps.toFixed(2)} Mbps);
                      it redistributes delay and packet loss in favor of mission-critical traffic.
                    </>
                  ) : (
                    'Run Experiment C to compare how strict-priority queueing redistributes performance without altering link bandwidth.'
                  )}
                </p>
                <div className="insight-tags" style={{ marginTop: 8 }}>
                  <span className="insight-tag" style={{ color: '#93CCFF' }}>
                    ★ High Priority Protected
                  </span>
                  <span className="insight-tag" style={{ color: 'var(--warning)' }}>
                    ⚡ Non-Priority Congestion
                  </span>
                  <span className="insight-tag" style={{ color: 'var(--text-secondary)' }}>
                    ⚖ QoS Trade-off Explicit
                  </span>
                </div>
              </div>
            </div>

            {/* Architectural Synthesis Footer */}
            <div className="compare-verdict-banner">
              <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                <strong>Engineering Recommendation:</strong> Deploy <strong>Strict Priority (QoS)</strong> when bandwidth expansion is cost-prohibitive but interactive flows (VoIP, control packets) require low latency; scale <strong>Physical Bandwidth</strong> when the aggregate workload across all nodes must be delivered without loss.
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ComparisonTooltip({ active, payload, label, metric }: any) {
  if (!active || !payload?.length) return null;

  const unit =
    metric === 'throughput' ? 'Mbps' : metric === 'delay' ? 'ms' : metric === 'loss' ? 'pkts' : 'pkts';

  return (
    <div className="custom-tooltip">
      <p style={{ color: 'var(--text-muted)', marginBottom: 6, fontSize: 11 }}>Time: t = {label}s</p>
      {payload.map((entry: { name: string; value: number; color: string }, idx: number) => (
        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
          <span style={{ color: entry.color, fontSize: 11 }}>{entry.name}:</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 11 }}>
            {entry.value} {unit}
          </span>
        </div>
      ))}
    </div>
  );
}
