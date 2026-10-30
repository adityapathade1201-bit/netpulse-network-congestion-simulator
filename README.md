# NetPulse — Computer Network Congestion Simulator

NetPulse is an interactive, packet-level discrete-event network simulator built with React 19, TypeScript, Vite, and Recharts. Designed for network engineering education, it visualizes bottleneck behavior, queue dynamics, queueing delay, and packet loss in real time.

---

## Key Features

- **Interactive Topology Canvas**: Network topology rendered with `@xyflow/react`, highlighting sender nodes, queue backlogs, link utilization, and packet drops.
- **NetSim-inspired dashboard**: Four headline metrics, animated topology, compact Simulation Settings, a throughput chart, and a congestion monitor with a rule-based recommendation.
- **Configurable Parameters**: Adjust connected devices (1–20), aggregate packet arrival rate, per-host Mbps rates, bottleneck link bandwidth, packet size, buffer capacity, propagation delay, traffic duration, random seed, and Constant vs. Bursty traffic.
- **Automatic Congestion Control**: Optional educational queue-feedback mode adjusts future packet inter-arrival gaps based on observed queue pressure and packet drops. This is not TCP Reno/CUBIC/BBR.
- **Live-style KPI Telemetry**: Calculation of delivered throughput, end-to-end delay, packet loss percentage, and queue utilization/peak occupancy from simulation results.
- **Time-Series Charts**: Recharts plots tracking delivered throughput, average delay, and queue occupancy over time.
- **Experiment Comparison**: Side-by-side execution and evaluation of 3 standardized experiments:
  - **Experiment A**: Baseline Congestion (15.0 Mbps offered load over 10.0 Mbps link with Drop-Tail).
  - **Experiment B**: Increased Bandwidth (20.0 Mbps bottleneck alleviating all congestion).
  - **Experiment C**: Strict Priority Queueing (prioritizes Host A interactive traffic over normal flows).
- **CSV Data Export**: One-click download of RFC 4180-compliant summary and time-series benchmark datasets.

---

## Discrete-Event Simulation Model

NetPulse implements a cycle-accurate discrete-event packet simulator operating in three chronological phases:

1. **Traffic Generation**: Senders generate packets at configured transmission rates ($R_i$). Inter-arrival intervals are either uniform (CBR) or exponentially distributed (Bursty) using a deterministic 32-bit Mulberry32 PRNG.
2. **Event Queue & Scheduling**: Events (`packet_arrived`, `tx_start`, `tx_complete`, `packet_delivered`) are processed in strict priority order. When departure and arrival events share an identical timestamp, departures are processed first to accurately free buffer capacity before arrival admission checks.
3. **Queue Disciplines**:
   - **Drop-Tail (FIFO)**: Packets are enqueued in arrival order. When the waiting queue length reaches `queueCapacity`, subsequent arriving packets are dropped.
   - **Strict Priority (PQ)**: Packets designated as `priority: 'high'` (Host A) are routed into a dedicated high-priority queue; normal packets enter the normal queue. The bottleneck link scheduler always transmits from the high-priority queue first before servicing normal-priority packets.

### Delay & Throughput Formulation

- **Transmission Delay**:
  $$T_{\text{tx}} = \frac{\text{packetBits}}{\text{bottleneckBps}} \times 1000 \text{ ms}$$
- **Queueing Delay**:
  $$T_{\text{queue}} = T_{\text{txStart}} - T_{\text{arrived}}$$
- **End-to-End Delay**:
  $$T_{\text{e2e}} = T_{\text{queue}} + T_{\text{tx}} + T_{\text{prop}}$$
- **Delivered Throughput**:
  $$\text{Throughput (Mbps)} = \frac{\sum \text{Delivered Packets} \times \text{packetBits}}{\text{measurementInterval (seconds)} \times 10^6}$$

### Assumptions & Limitations (Milestone v1)
- Single bottleneck router topology with access links modeled with negligible access delay.
- Open-loop traffic sources (no TCP ACK feedback, congestion window adjustment, or retransmissions in v1).
- Unicast traffic directed to a single sink receiver.

---

## Dashboard workflow

1. Choose the number of connected hosts and configure aggregate traffic or advanced per-host rates.
2. Set the bottleneck bandwidth and router queue capacity; optional advanced settings include packet size, propagation delay, duration, random seed, traffic pattern, and queue policy.
3. Run the simulation, then inspect the animated network topology, KPI cards, and selected time-series metric.
4. Review the Congestion Monitor's queue pressure, delivery summary, and rule-based recommendation.
5. Use Compare Experiments to compare baseline, higher bandwidth, and strict-priority queueing. Export the actual results to CSV.

## Project Structure

```
netpulse/
├── index.html                   # HTML entry point with meta tags
├── package.json                 # Scripts: dev, build, preview, test
├── tsconfig.json                # TypeScript 5+ compiler config with react-jsx
├── vite.config.ts               # Vite configuration with code splitting
├── dist/                        # Production build output
└── src/
    ├── main.tsx                 # React entry point with StrictMode
    ├── App.tsx                  # Root app layout with tab navigation
    ├── index.css                # Design system and theme stylesheet
    ├── config/
    │   └── defaults.ts          # Default configuration parameters & slider bounds
    ├── engine/
    │   ├── SeededRandom.ts      # Mulberry32 PRNG with uniform/exponential samplers
    │   ├── types.ts             # Core simulation type definitions
    │   ├── simulator.ts         # Discrete-event packet simulator
    │   ├── index.ts             # Public engine API
    │   └── __tests__/           # Engine Vitest suite
    ├── experiments/
    │   ├── definitions.ts       # Experiments A, B, and C specifications
    │   ├── csvExport.ts         # RFC 4180 CSV export & download engine
    │   └── __tests__/           # Experiment & CSV Vitest suite
    └── components/
        ├── ConfigPanel.tsx      # Sidebar slider controls & traffic options
        ├── TopologyCanvas.tsx   # React Flow network topology visualization
        ├── KpiCards.tsx         # Primary metric overview cards
        ├── MetricsChart.tsx     # Recharts performance dynamics graphs
        ├── InsightsPanel.tsx    # Automated telemetry facts & congestion diagnosis
        └── ExperimentComparison.tsx # Multi-experiment comparison & matrix
```

---

## Getting Started

### Prerequisites
- Node.js (v18.0.0 or higher)
- npm (v9.0.0 or higher)

### Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/your-username/netpulse.git
cd netpulse
npm install
```

### Local Development Server
Launch the Vite development server:
```bash
npm run dev
```
Open `http://localhost:5173/` in your browser.

### Running Automated Tests
Execute the Vitest suite:
```bash
npm run test
```

### Production Build
Compile and bundle the application for production:
```bash
npm run build
```
To preview the production bundle locally:
```bash
npm run preview
```

---

## Deployment (Vercel)

This application is ready for zero-configuration deployment on [Vercel](https://vercel.com):

1. Push your repository to GitHub.
2. In the Vercel dashboard, click **Add New Project** and select your repository.
3. Configure the project settings:
   - **Framework Preset**: `Vite`
   - **Root Directory**: `netpulse` (or `./` if deployed directly from the repo root)
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. Click **Deploy**.

---

## License
MIT License. Built for hackathons, computer network coursework, and protocol exploration.

## Additional visualization & source-scaling features

- **Up to 20 sender hosts**: Change the connected-device count in the Simulator configuration. The network still models one shared router and one bottleneck link; this is not a 20-router mesh topology.
- **Packet-flow replay**: The topology samples recorded `packet_arrived`, `tx_start`, and `packet_delivered` events and animates dots along the associated links. Replay restarts the visual playback without recalculating or changing simulation metrics.
- **Selectable queue policy**: Drop-Tail (FIFO) or Strict Priority. When Priority is selected, Host A is assigned the high-priority class and the remaining hosts use normal priority.
- **Large-scenario handling**: Runs above 250,000 estimated packets switch to a memory-bounded packet-by-packet engine that samples only the visual trace while preserving all-packet aggregate metrics. Runs estimated above 5,000,000 packets are blocked by the browser safety guard.
- **Stale-result protection**: Editing simulation settings clears the previous run so old metrics are not shown beside a new configuration.

### Adapted from the separate NetSim prototype

The reference uses a wall-clock `setInterval` simulation with a fixed packet-size constant and counts deliveries from animation completion. NetPulse does not copy that loop. It keeps the existing simulation engine as the source of truth, adapts the reference's flowing links and animated packet style, and records queue/drop events for visual replay. The optional automatic-control toggle uses a separate, tested, queue-feedback model that adapts future packet inter-arrival gaps; it is explicitly not presented as TCP congestion control.


## Automatic Congestion Control (educational feedback mode)

The Simulator settings include an optional rule-based queue-feedback controller. It samples queue pressure at fixed intervals, reduces future packet-generation rates when queue pressure is high or drops occur, and gradually restores the configured rate when the queue is quiet. Control adjustments are recorded in the simulation event timeline and shown in Congestion Insights.

This is an educational feedback model, **not** an implementation of TCP Reno, CUBIC, BBR, or a production congestion-control protocol. The configured offered load remains the sender demand; actual generated traffic can be lower when the controller is enabled. Use the open-loop run and feedback-enabled run as a controlled comparison.

The topology also supports up to 20 sender hosts sharing one router and one bottleneck, animated links and packet event replay, pause/resume for the visual replay, congestion status, a rule-based recommendation panel, and CSV exports in the comparison screen.

## High-rate simulations

For configurations estimated to generate more than 250,000 packets, NetPulse switches to a memory-bounded packet-by-packet engine. It still processes every packet through the configured queue and link service logic and calculates aggregate metrics across all packets; it does not replace the packet model with an averaged fluid approximation. To keep browser memory predictable, the animation event trace stores a deterministic sample of packets, so high-rate animations are representative rather than exhaustive. The interface labels this mode. Runs estimated above 5,000,000 packets are blocked by a safety limit to reduce the risk of freezing a browser tab.
