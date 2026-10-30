import type { SimulationConfig, SenderConfig, TrafficPattern, QueuePolicy } from '../engine/types';
import { LIMITS } from '../config/defaults';
import { Activity, RotateCcw, SlidersHorizontal, Users, Play, Trash2, ChevronDown } from 'lucide-react';

interface ConfigPanelProps {
  config: SimulationConfig;
  onChange: (config: SimulationConfig) => void;
  onReset: () => void;
  onRun: () => void;
  onResetSimulation: () => void;
  disabled: boolean;
  hasResults: boolean;
}

const PALETTE = [
  '#38BDF8', '#06B6D4', '#4EDEA3', '#A78BFA', '#F59E0B',
  '#F472B6', '#60A5FA', '#34D399', '#FB7185', '#C084FC',
  '#22D3EE', '#A3E635', '#FBBF24', '#818CF8', '#2DD4BF',
  '#E879F9', '#93C5FD', '#86EFAC', '#FDA4AF', '#FDBA74',
];
const HOST_NAMES = Array.from({ length: 20 }, (_, i) => `Host ${String.fromCharCode(65 + i)}`);

export function ConfigPanel({ config, onChange, onReset, onRun, onResetSimulation, disabled, hasResults }: ConfigPanelProps) {
  const offeredLoad = config.senders.reduce((sum, sender) => sum + Math.max(0, sender.rateMbps), 0);
  const packetBits = Math.max(config.packetSizeBytes * 8, 1);
  const aggregatePps = offeredLoad * 1_000_000 / packetBits;
  const maxPps = Math.max(1, config.senders.length * LIMITS.senderRate.max * 1_000_000 / packetBits);
  const ppsPosition = Math.max(0, Math.min(100, Math.log(Math.max(aggregatePps, 1)) / Math.log(maxPps) * 100));
  const warning = offeredLoad > config.bottleneckBandwidthMbps;

  function updateSenderCount(count: number) {
    const safeCount = Math.max(1, Math.min(20, Math.round(count)));
    if (safeCount === config.senders.length) return;
    const nextSenders = config.senders.slice(0, safeCount);
    for (let i = nextSenders.length; i < safeCount; i++) {
      nextSenders.push({
        id: `sender-${String.fromCharCode(97 + i)}`,
        label: HOST_NAMES[i],
        rateMbps: i === 0 ? 6 : i === 1 ? 5 : i === 2 ? 4 : 1,
        color: PALETTE[i % PALETTE.length],
        priority: 'normal',
      });
    }
    onChange({ ...config, senders: nextSenders });
  }

  function updateSender(id: string, rateMbps: number) {
    const safeRate = clamp(rateMbps, LIMITS.senderRate.min, LIMITS.senderRate.max);
    onChange({ ...config, senders: config.senders.map(sender => sender.id === id ? { ...sender, rateMbps: safeRate } : sender) });
  }

  function updateField<K extends keyof SimulationConfig>(key: K, value: SimulationConfig[K]) {
    onChange({ ...config, [key]: value });
  }

  function updateQueuePolicy(policy: QueuePolicy) {
    const senders = config.senders.map((sender, index) => ({
      ...sender,
      priority: policy === 'priority' && index === 0 ? 'high' as const : 'normal' as const,
    }));
    onChange({ ...config, queuePolicy: policy, senders });
  }

  function setAggregateArrivalRate(position: number) {
    const safePos = clamp(position, 0, 100) / 100;
    const targetPps = Math.exp(Math.log(1) + safePos * Math.log(maxPps));
    const targetTotalMbps = targetPps * packetBits / 1_000_000;
    const perSenderMbps = clamp(targetTotalMbps / Math.max(config.senders.length, 1), 0, LIMITS.senderRate.max);
    onChange({
      ...config,
      senders: config.senders.map(sender => ({ ...sender, rateMbps: Number(perSenderMbps.toFixed(3)) })),
    });
  }

  return (
    <aside className="config-panel settings-panel">
      <div className="settings-panel-heading">
        <div>
          <p className="eyebrow">CONFIGURATION</p>
          <h2>Simulation Settings</h2>
        </div>
        <div className="settings-heading-icon"><SlidersHorizontal size={17} /></div>
      </div>

      <section className="settings-group">
        <div className="setting-title-row"><Users size={14} /><span>Connected Devices</span><strong>{config.senders.length} / 20</strong></div>
        <input
          type="range" className="settings-range device-range" min={1} max={20} step={1}
          value={config.senders.length} disabled={disabled} aria-label="Connected devices"
          onChange={event => updateSenderCount(Number(event.target.value))}
        />
        <div className="range-hints"><span>1 device</span><span>20 devices</span></div>
        <p className="setting-help">All sender hosts share one router and bottleneck link.</p>
      </section>

      <section className="settings-group">
        <SettingRange
          label="Network Bandwidth" value={config.bottleneckBandwidthMbps} unit="Mbps"
          min={1} max={100} step={1} disabled={disabled}
          onChange={value => updateField('bottleneckBandwidthMbps', value)}
          lowLabel="1 Mbps" highLabel="100 Mbps"
        />
        <p className="setting-help">Use Advanced Settings for link capacities above 100 Mbps.</p>
      </section>

      <section className="settings-group">
        <div className="setting-title-row"><Activity size={14} /><span>Packet Arrival Rate</span><strong>{Math.round(aggregatePps).toLocaleString()} pkt/s</strong></div>
        <input
          type="range" className="settings-range" min={0} max={100} step={1}
          value={ppsPosition} disabled={disabled} aria-label="Aggregate packet arrival rate"
          onChange={event => setAggregateArrivalRate(Number(event.target.value))}
        />
        <div className="range-hints"><span>1 pkt/s</span><span>{Math.round(maxPps).toLocaleString()} pkt/s</span></div>
        <p className="setting-help">Adjusts all sender rates evenly. Exact offered load depends on packet size.</p>
        <div className="offered-load-inline"><span>Total offered load</span><strong className={warning ? 'text-warning' : ''}>{offeredLoad.toFixed(1)} Mbps</strong></div>
      </section>

      <section className="settings-group">
        <SettingRange
          label="Router Queue Capacity" value={config.queueCapacity} unit="packets"
          min={5} max={1000} step={1} disabled={disabled}
          onChange={value => updateField('queueCapacity', Math.round(value))}
          lowLabel="5 packets" highLabel="1000 packets"
        />
        <p className="setting-help">Use Advanced Settings for buffers above 1000 packets.</p>
        {warning && <p className="settings-warning">⚠ Offered load exceeds link capacity; queue buildup or drops may occur.</p>}
      </section>

      <label className={`auto-control-card${config.automaticCongestionControl ? ' enabled' : ''}`} htmlFor="automaticCongestionControl">
        <span className="auto-control-copy">
          <strong>Automatic Congestion Control</strong>
          <small>Rule-based feedback reduces future sender rates when queue pressure or packet drops rise.</small>
          <em>Educational controller — not TCP Reno/CUBIC/BBR.</em>
        </span>
        <input
          id="automaticCongestionControl" type="checkbox"
          checked={Boolean(config.automaticCongestionControl)} disabled={disabled}
          onChange={event => updateField('automaticCongestionControl', event.target.checked)}
        />
      </label>

      <div className="settings-actions">
        <button type="button" className="btn btn-primary" onClick={onRun} disabled={disabled}>
          <Play size={14} fill="currentColor" /> Run Simulation
        </button>
        <button type="button" className="btn btn-secondary" onClick={onResetSimulation} disabled={disabled} title="Clear simulation results and warnings" aria-label={hasResults ? "Reset simulation results" : "Clear simulation warning"}>
          <Trash2 size={14} /> Reset
        </button>
      </div>
      <p className="settings-note">Packet-animation Pause and Replay controls appear on the topology after a run.</p>

      <details className="advanced-settings">
        <summary><span><SlidersHorizontal size={13} /> Advanced Settings</span><ChevronDown size={14} className="advanced-chevron" /></summary>
        <div className="advanced-settings-body">
          <div className="advanced-subheading">Per-host sending rates</div>
          <p className="setting-help">Override aggregate rate distribution for individual hosts.</p>
          <div className="per-host-rate-list">
            {config.senders.map(sender => (
              <SenderRow key={sender.id} sender={sender} disabled={disabled} onChange={rate => updateSender(sender.id, rate)} />
            ))}
          </div>

          <div className="advanced-subheading">Packet & link details</div>
          <SettingNumber label="Network Bandwidth" value={config.bottleneckBandwidthMbps} unit="Mbps" min={LIMITS.bottleneckBw.min} max={LIMITS.bottleneckBw.max} step={0.1} disabled={disabled} onChange={value => updateField('bottleneckBandwidthMbps', value)} />
          <SettingNumber label="Buffer Capacity" value={config.queueCapacity} unit="packets" min={LIMITS.queueCapacity.min} max={LIMITS.queueCapacity.max} step={1} disabled={disabled} onChange={value => updateField('queueCapacity', Math.round(value))} />
          <SettingNumber label="Packet Size" value={config.packetSizeBytes} unit="B" min={LIMITS.packetSize.min} max={LIMITS.packetSize.max} step={1} disabled={disabled} onChange={value => updateField('packetSizeBytes', Math.round(value))} />
          <SettingNumber label="Propagation Delay" value={config.propagationDelayMs} unit="ms" min={LIMITS.propagationDelay.min} max={LIMITS.propagationDelay.max} step={1} disabled={disabled} onChange={value => updateField('propagationDelayMs', value)} />
          <SettingNumber label="Simulation Duration" value={config.simulationDurationS} unit="sec" min={LIMITS.simDuration.min} max={LIMITS.simDuration.max} step={1} disabled={disabled} onChange={value => updateField('simulationDurationS', Math.round(value))} />
          <SettingNumber label="Random Seed" value={config.randomSeed} unit="" min={LIMITS.seed.min} max={LIMITS.seed.max} step={1} disabled={disabled} onChange={value => updateField('randomSeed', Math.round(value))} />

          <div className="advanced-subheading">Traffic & queue policy</div>
          <div className="traffic-toggle settings-traffic-toggle">
            <button type="button" className={config.trafficPattern === 'constant' ? 'active' : ''} onClick={() => updateField('trafficPattern', 'constant' as TrafficPattern)} disabled={disabled}>Constant</button>
            <button type="button" className={config.trafficPattern === 'bursty' ? 'active' : ''} onClick={() => updateField('trafficPattern', 'bursty' as TrafficPattern)} disabled={disabled}>Bursty</button>
          </div>
          <label className="advanced-field-label" htmlFor="queuePolicySelect">Queue Policy</label>
          <select id="queuePolicySelect" className="config-select" value={config.queuePolicy} disabled={disabled} onChange={event => updateQueuePolicy(event.target.value as QueuePolicy)}>
            <option value="drop-tail">Drop-Tail (FIFO)</option>
            <option value="priority">Strict Priority</option>
          </select>
          {config.queuePolicy === 'priority' && <p className="setting-help">Host A is high priority; remaining hosts are normal priority. Buffer capacity applies separately to each class.</p>}
          <button type="button" className="reset-link" onClick={onReset} disabled={disabled}><RotateCcw size={12} /> Restore Defaults</button>
        </div>
      </details>
    </aside>
  );
}

function SettingRange({ label, value, unit, min, max, step, disabled, onChange, lowLabel, highLabel }: {
  label: string; value: number; unit: string; min: number; max: number; step: number; disabled: boolean;
  onChange: (value: number) => void; lowLabel: string; highLabel: string;
}) {
  const sliderMin = min;
  const sliderMax = max;
  return (
    <>
      <div className="setting-title-row"><span>{label}</span><strong>{formatNumber(value)} <small>{unit}</small></strong></div>
      <input
        type="range" className="settings-range" min={sliderMin} max={sliderMax} step={step}
        value={clamp(value, sliderMin, sliderMax)} disabled={disabled} aria-label={label}
        onChange={event => onChange(clamp(Number(event.target.value), min, max))}
      />
      <div className="range-hints"><span>{lowLabel}</span><span>{highLabel}</span></div>
    </>
  );
}

function SettingNumber({ label, value, unit, min, max, step, disabled, onChange }: {
  label: string; value: number; unit: string; min: number; max: number; step: number; disabled: boolean; onChange: (value: number) => void;
}) {
  return (
    <label className="advanced-number-row">
      <span>{label}</span>
      <span className="advanced-number-inputs">
        <input type="number" className="config-input" value={value} min={min} max={max} step={step} disabled={disabled}
          onChange={event => { const parsed = Number(event.target.value); if (Number.isFinite(parsed)) onChange(clamp(parsed, min, max)); }} />
        <small>{unit}</small>
      </span>
    </label>
  );
}

function SenderRow({ sender, disabled, onChange }: { sender: SenderConfig; disabled: boolean; onChange: (rate: number) => void }) {
  return (
    <div className="sender-rate-row">
      <div className="sender-rate-heading">
        <span className="sender-label"><span className="sender-color-dot" style={{ background: sender.color }} />{sender.label}</span>
        <span className="sender-rate-value"><input type="number" className="config-input" value={sender.rateMbps} min={LIMITS.senderRate.min} max={LIMITS.senderRate.max} step={0.1} disabled={disabled}
          onChange={event => { const parsed = Number(event.target.value); if (Number.isFinite(parsed)) onChange(parsed); }} /><small>Mbps</small></span>
      </div>
      <input type="range" className="config-slider" value={sender.rateMbps} min={LIMITS.senderRate.min} max={LIMITS.senderRate.max} step={0.1} disabled={disabled} aria-label={`${sender.label} rate`}
        onChange={event => onChange(Number(event.target.value))}
        style={{ background: `linear-gradient(to right, ${sender.color} ${(sender.rateMbps / LIMITS.senderRate.max) * 100}%, var(--surface-3) ${(sender.rateMbps / LIMITS.senderRate.max) * 100}%)` }} />
    </div>
  );
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: value < 10 ? 1 : 0 });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
