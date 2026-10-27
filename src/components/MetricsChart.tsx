import { useState } from 'react';
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
import type { SimulationResults, SimulationConfig } from '../engine/types';

type ChartMetric = 'throughput' | 'queue' | 'delay';

interface MetricsChartProps {
  config: SimulationConfig;
  results: SimulationResults | null;
}

export function MetricsChart({ config, results }: MetricsChartProps) {
  const [metric, setMetric] = useState<ChartMetric>('throughput');

  const chartData = results?.timeSeries.map(s => ({
    time: (s.time / 1000).toFixed(1),
    timeNum: s.time / 1000,
    throughput: Number(s.throughputMbps.toFixed(2)),
    offeredLoad: Number(s.offeredLoadMbps.toFixed(2)),
    queue: s.queueLength,
    delay: Number(s.avgDelayMs.toFixed(1)),
    dropped: s.droppedInWindow,
  })) ?? [];

  return (
    <div className="chart-container">
      <div className="chart-header">
        <span className="chart-title">Performance Dynamics over Time</span>
        <div className="chart-selector">
          <button
            className={metric === 'throughput' ? 'active' : ''}
            onClick={() => setMetric('throughput')}
          >
            Throughput (Mbps)
          </button>
          <button
            className={metric === 'queue' ? 'active' : ''}
            onClick={() => setMetric('queue')}
          >
            Queue Length (pkts)
          </button>
          <button
            className={metric === 'delay' ? 'active' : ''}
            onClick={() => setMetric('delay')}
          >
            Packet Delay (ms)
          </button>
        </div>
      </div>

      <div className="chart-body">
        {chartData.length === 0 ? (
          <div className="ready-state" style={{ height: '100%' }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Run simulation to see chart data
            </span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {metric === 'throughput' ? (
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="4 4" stroke="#2D3748" horizontal vertical={false} />
                <XAxis
                  dataKey="time"
                  interval="preserveStartEnd"
                  minTickGap={28}
                  tick={{ fill: '#94A3B8', fontSize: 11 }}
                  axisLine={{ stroke: '#2D3748' }}
                  tickLine={false}
                  label={{ value: 'Time (s)', position: 'insideBottomRight', offset: -5, fill: '#64748B', fontSize: 11 }}
                />
                <YAxis
                  tick={{ fill: '#94A3B8', fontSize: 11 }}
                  axisLine={{ stroke: '#2D3748' }}
                  tickLine={false}
                  label={{ value: 'Mbps', angle: -90, position: 'insideLeft', fill: '#64748B', fontSize: 11 }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: 11, paddingTop: 8, color: '#94A3B8' }}
                />
                <ReferenceLine
                  y={config.bottleneckBandwidthMbps}
                  stroke="#EF4444"
                  strokeDasharray="6 4"
                  strokeWidth={1}
                  label={{
                    value: `Bottleneck ${config.bottleneckBandwidthMbps} Mbps`,
                    fill: '#EF4444',
                    fontSize: 10,
                    position: 'right',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="offeredLoad"
                  name="Offered Load"
                  stroke="#F59E0B"
                  strokeDasharray="6 4"
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="throughput"
                  name="Delivered Throughput"
                  stroke="#0284C7"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3 }}
                />
              </LineChart>
            ) : metric === 'queue' ? (
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="4 4" stroke="#2D3748" horizontal vertical={false} />
                <XAxis
                  dataKey="time"
                  interval="preserveStartEnd"
                  minTickGap={28}
                  tick={{ fill: '#94A3B8', fontSize: 11 }}
                  axisLine={{ stroke: '#2D3748' }}
                  tickLine={false}
                  label={{ value: 'Time (s)', position: 'insideBottomRight', offset: -5, fill: '#64748B', fontSize: 11 }}
                />
                <YAxis
                  tick={{ fill: '#94A3B8', fontSize: 11 }}
                  axisLine={{ stroke: '#2D3748' }}
                  tickLine={false}
                  label={{ value: 'Packets', angle: -90, position: 'insideLeft', fill: '#64748B', fontSize: 11 }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: 11, paddingTop: 8, color: '#94A3B8' }}
                />
                <ReferenceLine
                  y={config.queueCapacity}
                  stroke="#EF4444"
                  strokeDasharray="6 4"
                  strokeWidth={1}
                  label={{
                    value: `Buffer Limit ${config.queueCapacity}`,
                    fill: '#EF4444',
                    fontSize: 10,
                    position: 'right',
                  }}
                />
                <Line
                  type="stepAfter"
                  dataKey="queue"
                  name="Queue Length"
                  stroke="#06B6D4"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3 }}
                />
              </LineChart>
            ) : (
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="4 4" stroke="#2D3748" horizontal vertical={false} />
                <XAxis
                  dataKey="time"
                  interval="preserveStartEnd"
                  minTickGap={28}
                  tick={{ fill: '#94A3B8', fontSize: 11 }}
                  axisLine={{ stroke: '#2D3748' }}
                  tickLine={false}
                  label={{ value: 'Time (s)', position: 'insideBottomRight', offset: -5, fill: '#64748B', fontSize: 11 }}
                />
                <YAxis
                  tick={{ fill: '#94A3B8', fontSize: 11 }}
                  axisLine={{ stroke: '#2D3748' }}
                  tickLine={false}
                  label={{ value: 'ms', angle: -90, position: 'insideLeft', fill: '#64748B', fontSize: 11 }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: 11, paddingTop: 8, color: '#94A3B8' }}
                />
                <ReferenceLine
                  y={config.propagationDelayMs}
                  stroke="#10B981"
                  strokeDasharray="6 4"
                  strokeWidth={1}
                  label={{
                    value: `Min delay ${config.propagationDelayMs}ms`,
                    fill: '#10B981',
                    fontSize: 10,
                    position: 'right',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="delay"
                  name="Avg Delay"
                  stroke="#F59E0B"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3 }}
                />
              </LineChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="custom-tooltip">
      <p style={{ color: 'var(--text-muted)', marginBottom: 4, fontSize: 11 }}>t = {label}s</p>
      {payload.map((entry: { name: string; value: number; color: string }, i: number) => (
        <p key={i} style={{ color: entry.color }}>
          {entry.name}: <span className="value">{entry.value}</span>
        </p>
      ))}
    </div>
  );
}
