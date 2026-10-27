import { useState, useCallback, lazy, Suspense } from 'react';
import { Zap, BarChart2, Play, RotateCcw, Loader, ArrowLeftRight } from 'lucide-react';
import { runSimulation } from './engine/simulator';
import type { SimulationConfig, SimulationResults } from './engine/types';
import { DEFAULT_CONFIG } from './config/defaults';
import { ConfigPanel } from './components/ConfigPanel';
import { TopologyCanvas } from './components/TopologyCanvas';
import { KpiCards } from './components/KpiCards';
import { MetricsChart } from './components/MetricsChart';
import { InsightsPanel } from './components/InsightsPanel';

const ExperimentComparison = lazy(() =>
  import('./components/ExperimentComparison').then(m => ({ default: m.ExperimentComparison }))
);

type ActiveTab = 'simulator' | 'compare';
type EngineState = 'ready' | 'running' | 'completed' | 'congested';

function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('simulator');
  const [config, setConfig] = useState<SimulationConfig>({ ...DEFAULT_CONFIG });
  const [results, setResults] = useState<SimulationResults | null>(null);
  const [engineState, setEngineState] = useState<EngineState>('ready');

  const handleRun = useCallback(() => {
    setEngineState('running');
    // Use setTimeout to allow UI to update before blocking compute
    setTimeout(() => {
      try {
        const result = runSimulation(config);
        setResults(result);
        setEngineState(result.congestionDetected ? 'congested' : 'completed');
      } catch (err) {
        console.error('Simulation failed:', err);
        setEngineState('ready');
      }
    }, 50);
  }, [config]);

  const handleReset = useCallback(() => {
    setResults(null);
    setEngineState('ready');
  }, []);

  const handleResetDefaults = useCallback(() => {
    setConfig({ ...DEFAULT_CONFIG });
    setResults(null);
    setEngineState('ready');
  }, []);

  const statusDotClass =
    engineState === 'running' ? 'status-dot running'
    : engineState === 'congested' ? 'status-dot congested'
    : 'status-dot';

  const statusLabel =
    engineState === 'ready' ? 'Ready'
    : engineState === 'running' ? 'Running...'
    : engineState === 'congested' ? 'Congested'
    : 'Completed';

  return (
    <div className="app-layout">
      {/* ─── Header ──────────────────────────────────────────────── */}
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div className="header-brand">
            <div className="header-logo">
              <Zap size={16} />
            </div>
            <div>
              <div className="header-title">NetPulse</div>
              <div className="header-subtitle">Network Simulator</div>
            </div>
          </div>

          <nav className="header-nav">
            <button
              className={`nav-link ${activeTab === 'simulator' ? 'active' : ''}`}
              onClick={() => setActiveTab('simulator')}
            >
              <BarChart2 size={14} />
              Simulator
            </button>
            <button
              className={`nav-link ${activeTab === 'compare' ? 'active' : ''}`}
              onClick={() => setActiveTab('compare')}
            >
              <ArrowLeftRight size={14} />
              Compare Experiments
            </button>
          </nav>
        </div>

        <div className="header-right">
          <div className="engine-status">
            {activeTab === 'simulator' ? (
              <>
                <div className={statusDotClass} />
                <span>{statusLabel}</span>
              </>
            ) : (
              <>
                <div className="status-dot" style={{ backgroundColor: 'var(--secondary)' }} />
                <span>Multi-Run Telemetry</span>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ─── Main Content ────────────────────────────────────────── */}
      <div className="app-main">
        {activeTab === 'simulator' ? (
          <>
            {/* Toolbar */}
            <div className="sim-toolbar">
              <button
                className="btn btn-primary"
                onClick={handleRun}
                disabled={engineState === 'running'}
              >
                {engineState === 'running' ? (
                  <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} />
                ) : (
                  <Play size={16} />
                )}
                {engineState === 'running' ? 'Simulating...' : 'Run Simulation'}
              </button>
              <button className="btn btn-secondary" onClick={handleReset}>
                <RotateCcw size={14} />
                Reset
              </button>
              {results && (
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    marginLeft: 8,
                  }}
                >
                  {results.totalPacketsSent.toLocaleString()} packets generated •{' '}
                  {results.totalPacketsDelivered.toLocaleString()} delivered •{' '}
                  {(results.measurementIntervalMs / 1000).toFixed(2)}s interval
                </span>
              )}
            </div>

            {/* Main Grid */}
            <div className="sim-grid">
              {/* Config Panel */}
              <ConfigPanel
                config={config}
                onChange={setConfig}
                onReset={handleResetDefaults}
                disabled={engineState === 'running'}
              />

              {/* Right Column */}
              <div className="sim-right">
                <TopologyCanvas config={config} results={results} />
                <KpiCards config={config} results={results} />
                <MetricsChart config={config} results={results} />
                <InsightsPanel config={config} results={results} />
              </div>
            </div>
          </>
        ) : (
          <Suspense
            fallback={
              <div
                className="flex-center"
                style={{
                  minHeight: 400,
                  flexDirection: 'column',
                  gap: 12,
                  color: 'var(--text-muted)',
                }}
              >
                <Loader size={28} style={{ animation: 'spin 1s linear infinite', color: 'var(--primary)' }} />
                <span style={{ fontSize: 13 }}>Loading Experiment Comparison...</span>
              </div>
            }
          >
            <ExperimentComparison />
          </Suspense>
        )}
      </div>
    </div>
  );
}

export default App;
