import express from 'express';
import http from 'http';
import path from 'path';
import cors from 'cors';
import fs from 'fs';
import YAML from 'yaml';
import { WebSocketServer, WebSocket } from 'ws';
import { VirtualPortaldotCluster } from '../consensus/virtual-portaldot-cluster';
import { EquivocationDetector } from '../consensus/equivocation-detector';
import { ScenarioRegistry } from '../scenarios/scenario-registry';
import { StalledHeartbeatScenario } from '../scenarios/stalled-heartbeat';
import { SplitBrainKeystoreScenario } from '../scenarios/split-brain-keystore';
import { MempoolBackpressureScenario } from '../scenarios/mempool-backpressure';
import { AuditGenerator } from '../reporting/audit-generator';
import { SlashingAuditReport, SubstrateHeader, ValidatorClusterConfig } from '../types';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Determine simulation mode: default to true on cloud hosting when pointing to 127.0.0.1
const primaryRpcEnv = process.env.PRIMARY_RPC || 'ws://127.0.0.1:9944';
const backupRpcEnv = process.env.BACKUP_RPC || 'ws://127.0.0.1:9945';
const simModeEnv = process.env.SIMULATION_MODE;

const isDefaultLocal = primaryRpcEnv.includes('127.0.0.1') || primaryRpcEnv.includes('localhost');
const initialSimMode = simModeEnv !== undefined ? simModeEnv === 'true' : isDefaultLocal;

let activeConfig: ValidatorClusterConfig = {
  network: 'portaldot-live',
  consensus: 'AURA-BABE',
  slotDurationMs: Number(process.env.SLOT_DURATION_MS) || 3000,
  simulationMode: initialSimMode,
  toxiproxyUrl: process.env.TOXIPROXY_URL || 'http://127.0.0.1:8474',
  primaryNode: {
    id: 'portaldot-val-01',
    rpcEndpoint: primaryRpcEnv,
    proxyName: 'primary-portaldot',
    authoringKey: process.env.VALIDATOR_KEY || '0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d'
  },
  backupNode: {
    id: 'portaldot-val-02',
    rpcEndpoint: backupRpcEnv,
    proxyName: 'backup-portaldot',
    authoringKey: process.env.VALIDATOR_KEY || '0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d'
  },
  pacemaker: {
    heartbeatTimeoutMs: 6000,
    failoverLock: 'raft',
    fencingTokenEnabled: true
  }
};

const configPath = path.resolve(process.cwd(), 'validator-setup.yml');
if (fs.existsSync(configPath)) {
  try {
    const rawYaml = fs.readFileSync(configPath, 'utf8');
    const parsed = YAML.parse(rawYaml);
    if (parsed.nodes) {
      if (!process.env.PRIMARY_RPC && parsed.nodes.primary?.rpc_endpoint) activeConfig.primaryNode.rpcEndpoint = parsed.nodes.primary.rpc_endpoint;
      if (!process.env.BACKUP_RPC && parsed.nodes.backup?.rpc_endpoint) activeConfig.backupNode.rpcEndpoint = parsed.nodes.backup.rpc_endpoint;
      if (parsed.nodes.primary?.authoring_key) activeConfig.primaryNode.authoringKey = parsed.nodes.primary.authoring_key;
      if (parsed.nodes.backup?.authoring_key) activeConfig.backupNode.authoringKey = parsed.nodes.backup.authoring_key;
    }
  } catch (err: any) {
    console.warn(`[WARN] Config file parse skipped: ${err.message}`);
  }
}

const cluster = new VirtualPortaldotCluster(activeConfig);
const detector = new EquivocationDetector();
let lastReport: SlashingAuditReport | null = null;

function broadcast(msg: object) {
  const data = JSON.stringify(msg);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

async function attachCluster() {
  try {
    await cluster.start(
      (header: SubstrateHeader, source: string) => {
        broadcast({ type: 'block', data: header, source });

        const proof = detector.processHeader(header);
        if (proof) {
          broadcast({ type: 'equivocation', data: proof });
          broadcast({
            type: 'log',
            data: `🚨 [EQUIVOCATION DETECTED]: Dual-proposals at Slot #${proof.slotNumber}! Slashed under NPoS consensus.`
          });
        }
      },
      (logMsg: string) => {
        broadcast({ type: 'log', data: logMsg });
      }
    );
  } catch (err: any) {
    broadcast({
      type: 'log',
      data: `[INIT ERROR] Could not connect to live nodes: ${err.message}. Switch to Simulation Mode in settings to run standalone.`
    });
  }
}

attachCluster();

app.get('/api/config', (req, res) => {
  res.json(cluster.getConfig());
});

app.post('/api/config', async (req, res) => {
  try {
    const updated = req.body as ValidatorClusterConfig;
    activeConfig = updated;
    cluster.updateConfig(updated);
    detector.reset();
    await attachCluster();
    broadcast({ type: 'configUpdated', data: activeConfig });
    res.json({ ok: true, config: activeConfig });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/toxic/latency', async (req, res) => {
  try {
    const { latency, jitter } = req.body;
    const cfg = cluster.getConfig();
    const toxicHarness = cluster.getToxiproxy();

    await toxicHarness.addToxic(cfg.primaryNode.proxyName, {
      name: 'latency-chaos',
      type: 'latency',
      stream: 'upstream',
      toxicity: 1.0,
      attributes: { latency: Number(latency) || 0, jitter: Number(jitter) || 0 }
    });

    cluster.getPrimaryClient().setSimulatedLatency(Number(latency) || 0);
    broadcast({ type: 'log', data: `[CHAOS] Injected ${latency}ms latency onto ${cfg.primaryNode.proxyName}` });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/chaos/stall', async (req, res) => {
  try {
    await StalledHeartbeatScenario.run(cluster, detector, (m) => broadcast({ type: 'log', data: m }));
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/chaos/split-brain', async (req, res) => {
  try {
    await SplitBrainKeystoreScenario.run(cluster, detector, (m) => broadcast({ type: 'log', data: m }));
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/chaos/backpressure', async (req, res) => {
  try {
    await MempoolBackpressureScenario.run(cluster, detector, (m) => broadcast({ type: 'log', data: m }));
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/chaos/audit', async (req, res) => {
  try {
    const report = await ScenarioRegistry.runAll(cluster, detector, (m) =>
      broadcast({ type: 'log', data: m })
    );
    lastReport = report;
    broadcast({ type: 'auditComplete', data: report });
    res.json(report);
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
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

setInterval(() => {
  broadcast({ type: 'clusterStatus', data: cluster.getStatus() });
}, 2000);

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🛡️  ChaosDot Server running on port ${PORT}`);
  console.log(`Consensus Mode: ${activeConfig.simulationMode ? 'Virtual Simulation' : 'Live WebSocket RPC'}`);
  console.log(`Primary RPC: ${activeConfig.primaryNode.rpcEndpoint}`);
  console.log(`Backup RPC:  ${activeConfig.backupNode.rpcEndpoint}`);
  console.log(`======================================================\n`);
});