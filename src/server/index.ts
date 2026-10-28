import express from 'express';
import http from 'http';
import path from 'path';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { VirtualPortaldotCluster } from '../consensus/virtual-portaldot-cluster';
import { EquivocationDetector } from '../consensus/equivocation-detector';
import { ToxiproxyHarness } from '../faults/toxiproxy-harness';
import { ScenarioRegistry } from '../scenarios/scenario-registry';
import { StalledHeartbeatScenario } from '../scenarios/stalled-heartbeat';
import { SplitBrainKeystoreScenario } from '../scenarios/split-brain-keystore';
import { MempoolBackpressureScenario } from '../scenarios/mempool-backpressure';
import { AuditGenerator } from '../reporting/audit-generator';
import { SlashingAuditReport, SubstrateHeader } from '../types';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Core System Instances
const cluster = new VirtualPortaldotCluster();
const detector = new EquivocationDetector();
const proxy = new ToxiproxyHarness();
let lastReport: SlashingAuditReport | null = null;

// Broadcast to connected web clients
function broadcast(msg: object) {
  const data = JSON.stringify(msg);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

// Consensus Block callback
cluster.start(
  (header: SubstrateHeader, source: string) => {
    broadcast({ type: 'block', data: header, source });

    // Check for equivocation
    const proof = detector.processHeader(header);
    if (proof) {
      broadcast({ type: 'equivocation', data: proof });
      broadcast({
        type: 'log',
        data: `🚨 [EQUIVOCATION EVENT DETECTED]: Slashed validator ${proof.validatorPublicKey.substring(0, 10)}... at Slot #${proof.slotNumber}`
      });
    }
  },
  (logMsg: string) => {
    broadcast({ type: 'log', data: logMsg });
  }
);

// REST API Endpoints
app.post('/api/toxic/latency', async (req, res) => {
  const { latency } = req.body;
  await proxy.addToxic('primary-portaldot', {
    name: 'latency-chaos',
    type: 'latency',
    stream: 'upstream',
    toxicity: 1.0,
    attributes: { latency: Number(latency) || 0, jitter: 50 }
  });
  broadcast({ type: 'log', data: `[CHAOS] Injected network latency: ${latency}ms` });
  res.json({ ok: true });
});

app.post('/api/chaos/stall', async (req, res) => {
  await StalledHeartbeatScenario.run(cluster, detector, (m) => broadcast({ type: 'log', data: m }));
  res.json({ ok: true });
});

app.post('/api/chaos/split-brain', async (req, res) => {
  await SplitBrainKeystoreScenario.run(cluster, detector, (m) => broadcast({ type: 'log', data: m }));
  res.json({ ok: true });
});

app.post('/api/chaos/backpressure', async (req, res) => {
  await MempoolBackpressureScenario.run(cluster, detector, (m) => broadcast({ type: 'log', data: m }));
  res.json({ ok: true });
});

app.post('/api/chaos/audit', async (req, res) => {
  const report = await ScenarioRegistry.runAll(cluster, detector, (m) =>
    broadcast({ type: 'log', data: m })
  );
  lastReport = report;
  broadcast({ type: 'auditComplete', data: report });
  res.json(report);
});

app.get('/api/report/html', (req, res) => {
  if (!lastReport) return res.status(404).send('No audit executed yet.');
  res.setHeader('Content-Type', 'text/html');
  res.send(AuditGenerator.generateHtml(lastReport));
});

app.get('/api/report/md', (req, res) => {
  if (!lastReport) return res.status(404).send('No audit executed yet.');
  res.setHeader('Content-Type', 'text/markdown');
  res.setHeader('Content-Disposition', 'attachment; filename="chaosdot-audit.md"');
  res.send(AuditGenerator.generateMarkdown(lastReport));
});

// Periodic status broadcast
setInterval(() => {
  broadcast({ type: 'clusterStatus', data: cluster.getStatus() });
}, 2000);

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🛡️  ChaosDot Server running at http://localhost:${PORT}`);
  console.log(`📡 WebSocket consensus stream ready for live testing`);
  console.log(`======================================================\n`);
});
