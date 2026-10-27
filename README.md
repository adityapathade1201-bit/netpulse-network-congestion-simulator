# NetPulse — Computer Network Congestion Simulator

NetPulse is an interactive, packet-level discrete-event network simulator built with React 19, TypeScript, Vite, and Recharts. Designed for network engineering education, it visualizes bottleneck behavior, queue dynamics, queueing delay, and packet loss in real time.

---

## Key Features

- **Interactive Topology Canvas**: Network topology rendered with `@xyflow/react`, highlighting sender nodes, queue backlogs, link utilization, and packet drops.
- **Configurable Parameters**: Real-time control of individual sender transmission rates, bottleneck link bandwidth, packet size, buffer capacity, propagation delay, and traffic patterns (Constant Bit Rate vs. Bursty).
- **Live KPI Telemetry**: Real-time computation of Delivered Throughput, End-to-End Delay, Packet Loss Percentage, and Peak Queue Occupancy.
- **Time-Series Charts**: Recharts line charts tracking Delivered Throughput, Average Delay, Packet Loss, and Queue Occupancy over time.
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
