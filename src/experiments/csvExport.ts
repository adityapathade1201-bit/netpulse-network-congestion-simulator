import type { ExperimentDefinition, ExperimentRunState } from './definitions';

/**
 * Escapes a single cell value according to RFC 4180.
 * If the value contains commas, double quotes, or newlines,
 * it is wrapped in quotes and any inner quotes are doubled ("").
 */
export function escapeCsvCell(val: string | number | boolean | null | undefined): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Converts a 2D array of rows into a valid CSV string.
 */
export function toCsvString(rows: (string | number | boolean | null | undefined)[][]): string {
  return rows.map(row => row.map(escapeCsvCell).join(',')).join('\r\n');
}

/**
 * Generates summary CSV content comparing all completed experiments.
 */
export function generateSummaryCsv(
  experiments: ExperimentDefinition[],
  runs: Record<string, ExperimentRunState>
): string {
  const headers = [
    'Experiment ID',
    'Experiment Name',
    'Traffic Configuration',
    'Bottleneck Capacity (Mbps)',
    'Queue Capacity (pkts)',
    'Queue Policy',
    'Random Seed',
    'Total Packets Sent',
    'Delivered Packet Count',
    'Dropped Packet Count',
    'Delivered Throughput (Mbps)',
    'Average Delay (ms)',
    'Packet Loss (%)',
    'Peak Queue Occupancy (pkts)',
    'Link Utilization (%)',
    'Measurement Duration (s)',
    'Status',
  ];

  const rows: (string | number | boolean | null | undefined)[][] = [headers];

  for (const exp of experiments) {
    const run = runs[exp.id];
    if (!run || run.status !== 'completed' || !run.result) {
      continue;
    }

    const res = run.result;
    const sendersDesc = exp.config.senders
      .map(s => `${s.label}: ${s.rateMbps}Mbps${s.priority ? ` (${s.priority})` : ''}`)
      .join('; ');
    const utilPct = ((res.deliveredThroughputMbps / exp.config.bottleneckBandwidthMbps) * 100);

    rows.push([
      `Experiment ${exp.key}`,
      exp.title,
      sendersDesc,
      exp.config.bottleneckBandwidthMbps,
      exp.config.queueCapacity,
      exp.config.queuePolicy === 'priority' ? 'Strict Priority' : 'Drop-Tail',
      exp.config.randomSeed,
      res.totalPacketsSent,
      res.totalPacketsDelivered,
      res.totalPacketsDropped,
      Number(res.deliveredThroughputMbps.toFixed(2)),
      Number(res.avgEndToEndDelayMs.toFixed(2)),
      Number(res.packetLossPercent.toFixed(2)),
      res.peakQueueOccupancy,
      Number(utilPct.toFixed(2)),
      Number((res.measurementIntervalMs / 1000).toFixed(2)),
      'Completed',
    ]);
  }

  return toCsvString(rows);
}

/**
 * Generates granular time-series CSV content for all completed experiments.
 */
export function generateTimeSeriesCsv(
  experiments: ExperimentDefinition[],
  runs: Record<string, ExperimentRunState>
): string {
  const headers = [
    'Time (s)',
    'Experiment',
    'Throughput (Mbps)',
    'Queue Length (pkts)',
    'Average Delay (ms)',
    'Packets Dropped in Window',
    'Offered Load (Mbps)',
  ];

  const rows: (string | number | boolean | null | undefined)[][] = [headers];

  for (const exp of experiments) {
    const run = runs[exp.id];
    if (!run || run.status !== 'completed' || !run.result) continue;

    for (const sample of run.result.timeSeries) {
      rows.push([
        Number((sample.time / 1000).toFixed(2)),
        `Experiment ${exp.key} (${exp.title})`,
        Number(sample.throughputMbps.toFixed(2)),
        sample.queueLength,
        Number(sample.avgDelayMs.toFixed(2)),
        sample.droppedInWindow,
        Number(sample.offeredLoadMbps.toFixed(2)),
      ]);
    }
  }

  return toCsvString(rows);
}

/**
 * Triggers a client-side download of a CSV file.
 */
export function downloadCsvFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
