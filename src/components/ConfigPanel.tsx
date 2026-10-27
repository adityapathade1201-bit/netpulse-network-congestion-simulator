import type { SimulationConfig, SenderConfig, TrafficPattern } from '../engine/types';
import { LIMITS } from '../config/defaults';
import { Sliders, Radio, Network, RotateCcw } from 'lucide-react';

interface ConfigPanelProps {
  config: SimulationConfig;
  onChange: (config: SimulationConfig) => void;
  onReset: () => void;
  disabled: boolean;
}

export function ConfigPanel({ config, onChange, onReset, disabled }: ConfigPanelProps) {
  const offeredLoad = config.senders.reduce((s, sender) => s + sender.rateMbps, 0);

  function updateSender(id: string, rateMbps: number) {
    onChange({
      ...config,
      senders: config.senders.map(s =>
        s.id === id ? { ...s, rateMbps: clamp(rateMbps, LIMITS.senderRate.min, LIMITS.senderRate.max) } : s
      ),
    });
  }

  function updateField<K extends keyof SimulationConfig>(key: K, value: SimulationConfig[K]) {
    onChange({ ...config, [key]: value });
  }

  return (
    <div className="config-panel">
      {/* Traffic Sources */}
      <div className="config-section">
        <div className="config-section-title">
          <Radio size={14} style={{ color: 'var(--secondary)' }} />
          <span>Traffic Sources</span>
        </div>

        {config.senders.map((sender) => (
          <SenderRow
            key={sender.id}
            sender={sender}
            disabled={disabled}
            onChange={(rate) => updateSender(sender.id, rate)}
          />
        ))}

        <div className="offered-load-badge">
          <span className="offered-load-label">Total Offered Load</span>
          <span className="offered-load-value">{offeredLoad.toFixed(1)} Mbps</span>
        </div>

        <div style={{ marginTop: 'var(--space-sm)' }}>
          <div className="config-section-title" style={{ marginBottom: 'var(--space-xs)' }}>
            Traffic Pattern
          </div>
          <div className="traffic-toggle">
            <button
              className={config.trafficPattern === 'constant' ? 'active' : ''}
              onClick={() => updateField('trafficPattern', 'constant' as TrafficPattern)}
              disabled={disabled}
            >
              Constant
            </button>
            <button
              className={config.trafficPattern === 'bursty' ? 'active' : ''}
              onClick={() => updateField('trafficPattern', 'bursty' as TrafficPattern)}
              disabled={disabled}
            >
              Bursty
            </button>
          </div>
        </div>
      </div>

      {/* Bottleneck Link */}
      <div className="config-section">
        <div className="config-section-title">
          <Network size={14} style={{ color: 'var(--secondary)' }} />
          <span>Bottleneck Link</span>
        </div>

        <ConfigInput
          label="Link Capacity"
          value={config.bottleneckBandwidthMbps}
          unit="Mbps"
          min={LIMITS.bottleneckBw.min}
          max={LIMITS.bottleneckBw.max}
          step={0.1}
          disabled={disabled}
          onChange={(v) => updateField('bottleneckBandwidthMbps', v)}
          warn={offeredLoad > config.bottleneckBandwidthMbps}
          warnText="Capacity < Offered Load (triggers drops)"
        />

        <ConfigInput
          label="Packet Size"
          value={config.packetSizeBytes}
          unit="B"
          min={LIMITS.packetSize.min}
          max={LIMITS.packetSize.max}
          step={1}
          disabled={disabled}
          onChange={(v) => updateField('packetSizeBytes', Math.round(v))}
        />

        <ConfigInput
          label="Propagation Delay"
          value={config.propagationDelayMs}
          unit="ms"
          min={LIMITS.propagationDelay.min}
          max={LIMITS.propagationDelay.max}
          step={1}
          disabled={disabled}
          onChange={(v) => updateField('propagationDelayMs', v)}
        />
      </div>

      {/* Router Queue */}
      <div className="config-section">
        <div className="config-section-title">
          <Sliders size={14} style={{ color: 'var(--secondary)' }} />
          <span>Router Queue</span>
        </div>

        <ConfigInput
          label="Buffer Capacity"
          value={config.queueCapacity}
          unit="pkts"
          min={LIMITS.queueCapacity.min}
          max={LIMITS.queueCapacity.max}
          step={1}
          disabled={disabled}
          onChange={(v) => updateField('queueCapacity', Math.round(v))}
        />

        <div className="config-row">
          <span className="config-label">Queue Policy</span>
          <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>
            Drop-Tail (FIFO)
          </span>
        </div>

        <ConfigInput
          label="Duration"
          value={config.simulationDurationS}
          unit="sec"
          min={LIMITS.simDuration.min}
          max={LIMITS.simDuration.max}
          step={1}
          disabled={disabled}
          onChange={(v) => updateField('simulationDurationS', Math.round(v))}
        />

        <ConfigInput
          label="Random Seed"
          value={config.randomSeed}
          unit=""
          min={LIMITS.seed.min}
          max={LIMITS.seed.max}
          step={1}
          disabled={disabled}
          onChange={(v) => updateField('randomSeed', Math.round(v))}
        />
      </div>

      <button className="reset-link" onClick={onReset} disabled={disabled}>
        <RotateCcw size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
        Restore Defaults
      </button>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function SenderRow({ sender, disabled, onChange }: { sender: SenderConfig; disabled: boolean; onChange: (rate: number) => void }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="config-row">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div className="sender-color-dot" style={{ background: sender.color }} />
          <span className="config-label">{sender.label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="number"
            className="config-input"
            value={sender.rateMbps}
            min={LIMITS.senderRate.min}
            max={LIMITS.senderRate.max}
            step={0.1}
            disabled={disabled}
            onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
            style={{ width: 64 }}
          />
          <span className="config-unit">Mbps</span>
        </div>
      </div>
      <input
        type="range"
        className="config-slider"
        value={sender.rateMbps}
        min={LIMITS.senderRate.min}
        max={LIMITS.senderRate.max}
        step={0.1}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          background: `linear-gradient(to right, ${sender.color} ${(sender.rateMbps / LIMITS.senderRate.max) * 100}%, var(--surface-3) ${(sender.rateMbps / LIMITS.senderRate.max) * 100}%)`,
        }}
      />
    </div>
  );
}

function ConfigInput({
  label, value, unit, min, max, step, disabled, onChange, warn, warnText,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onChange: (v: number) => void;
  warn?: boolean;
  warnText?: string;
}) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div className="config-row">
        <span className="config-label">{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="number"
            className="config-input"
            value={value}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v)) onChange(clamp(v, min, max));
            }}
          />
          <span className="config-unit">{unit}</span>
        </div>
      </div>
      {warn && warnText && (
        <div className="config-warning">
          ⚠ {warnText}
        </div>
      )}
    </div>
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}
