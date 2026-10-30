import { useState, useCallback, lazy, Suspense } from 'react';
import { Zap, BarChart2, Loader, ArrowLeftRight, RadioTower, WifiOff } from 'lucide-react';
import { runSimulation } from './engine/simulator';
import type { SimulationConfig, SimulationResults } from './engine/types';
import { DEFAULT_CONFIG } from './config/defaults';
import { ConfigPanel } from './components/ConfigPanel';
import { TopologyCanvas } from './components/TopologyCanvas';
import { KpiCards } from './components/KpiCards';
import { MetricsChart } from './components/MetricsChart';
import { InsightsPanel } from './components/InsightsPanel';

const ExperimentComparison = lazy(() =>
  import('./components/ExperimentComparison').then(module => ({ default: module.ExperimentComparison }))
);

type ActiveTab = 'simulator' | 'compare';
type EngineState = 'ready' | 'running' | 'completed' | 'congested';

function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('simulator');
  const [config, setConfig] = useState<SimulationConfig>({ ...DEFAULT_CONFIG });
  const [results, setResults] = useState<SimulationResults | null>(null);
  const [engineState, setEngineState] = useState<EngineState>('ready');
  const [runWarning, setRunWarning] = useState<string | null>(null);

  const handleRun = useCallback(() => {
    const offeredMbps = config.senders.reduce((sum, sender) => sum + Math.max(0, sender.rateMbps), 0);
    const expectedPackets = (offeredMbps * 1_000_000 * config.simulationDurationS) / Math.max(config.packetSizeBytes * 8, 1);
    const MAX_ESTIMATED_PACKETS = 5_000_000;
    if (expectedPackets > MAX_ESTIMATED_PACKETS) {
      setRunWarning(`This run is estimated to generate about ${Math.round(expectedPackets).toLocaleString()} packets, above the 5,000,000-packet browser safety limit. Shorten the duration, reduce traffic rates, or increase packet size.`);
      return;
    }
    setRunWarning(null);
    setResults(null);
    setEngineState('running');
    window.setTimeout(() => {
      try {
        const result = runSimulation(config);
        setResults(result);
        setEngineState(result.congestionDetected ? 'congested' : 'completed');
      } catch (error) {
        console.error('NetPulse simulation failed:', error);
        setRunWarning('The simulation could not complete. Check the configuration and try again.');
        setEngineState('ready');
      }
    }, 40);
  }, [config]);

  const handleConfigChange = useCallback((nextConfig: SimulationConfig) => {
    setConfig(nextConfig);
    setResults(null);
    setRunWarning(null);
    setEngineState('ready');
  }, []);

  const handleResetSimulation = useCallback(() => {
    setResults(null);
    setRunWarning(null);
    setEngineState('ready');
  }, []);

  const handleResetDefaults = useCallback(() => {
    setConfig({ ...DEFAULT_CONFIG, senders: DEFAULT_CONFIG.senders.map(sender => ({ ...sender })) });
    setResults(null);
    setRunWarning(null);
    setEngineState('ready');
  }, []);

  const statusDotClass =
    engineState === 'running' ? 'status-dot running'
      : engineState === 'congested' ? 'status-dot congested'
        : 'status-dot';
  const statusLabel =
    engineState === 'ready' ? 'Ready to simulate'
      : engineState === 'running' ? 'Simulating…'
        : engineState === 'congested' ? 'Congested'
          : 'Simulation completed';

  return (
    <div className="app-layout netsim-inspired-layout">
      <header className="app-header netsim-topbar">
        <div className="header-left-group">
          <div className="header-brand">
            <div className="header-logo"><Zap size={17} /></div>
            <div>
              <div className="header-title">NetPulse</div>
              <div className="header-subtitle">Network Lab</div>
            </div>
          </div>
          <nav className="header-nav" aria-label="Main navigation">
            <button className={`nav-link ${activeTab === 'simulator' ? 'active' : ''}`} onClick={() => setActiveTab('simulator')}>
              <BarChart2 size={14} /> Simulator
            </button>
            <button className={`nav-link ${activeTab === 'compare' ? 'active' : ''}`} onClick={() => setActiveTab('compare')}>
              <ArrowLeftRight size={14} /> Compare Experiments
            </button>
          </nav>
        </div>
        <div className="lab-status"><span className="lab-status-dot" /><RadioTower size={13} /> DATA COMMUNICATION LAB</div>
        <div className="header-right">
          <div className="offline-pill"><WifiOff size={12} /> OFFLINE MODE</div>
          {activeTab === 'compare' && (
            <div className="engine-status">
              <div className="status-dot" style={{ backgroundColor: 'var(--secondary)' }} />
              <span>Multi-run telemetry</span>
            </div>
          )}
        </div>
      </header>

      <main className="app-main netsim-main">
        {activeTab === 'simulator' ? (
          <div className="dashboard-container">
            <section className="page-heading netsim-page-heading">
              <div>
                <p className="eyebrow">DATA COMMUNICATION PROJECT</p>
                <h1>Network Congestion <span className="accent">&amp; Traffic Simulator</span></h1>
                <p className="subtitle">Simulate packet transmission, router queues, bandwidth limits, packet loss and congestion control.</p>
              </div>
              <div className={`simulation-status ${engineState === 'congested' ? 'status-danger' : engineState === 'running' ? 'status-warning' : ''}`}>
                <span className={statusDotClass} />
                <span>{statusLabel.toUpperCase()}</span>
              </div>
            </section>

            {runWarning && <div className="sim-run-warning" role="alert">{runWarning}</div>}

            <KpiCards config={config} results={results} />

            <div className="main-grid netsim-main-grid">
              <TopologyCanvas config={config} results={results} />
              <ConfigPanel
                config={config}
                onChange={handleConfigChange}
                onReset={handleResetDefaults}
                onRun={handleRun}
                onResetSimulation={handleResetSimulation}
                disabled={engineState === 'running'}
                hasResults={Boolean(results)}
              />
            </div>

            <div className="bottom-grid netsim-bottom-grid">
              <MetricsChart config={config} results={results} />
              <InsightsPanel config={config} results={results} />
            </div>
            <footer className="netsim-footer">NetPulse · Educational Network Simulation · Data Communication</footer>
          </div>
        ) : (
          <Suspense fallback={<div className="flex-center" style={{ minHeight: 400, flexDirection: 'column', gap: 12, color: 'var(--text-muted)' }}><Loader size={28} className="spin-icon" /><span style={{ fontSize: 13 }}>Loading Experiment Comparison…</span></div>}>
            <ExperimentComparison />
          </Suspense>
        )}
      </main>
    </div>
  );
}

export default App;
