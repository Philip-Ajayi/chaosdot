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

// Read baseline config from YAML if present
let activeConfig: ValidatorClusterConfig = {
  network: 'portaldot-live',
  consensus: 'AURA-BABE',
  slotDurationMs: 6000,
  toxiproxyUrl: process.env.TOXIPROXY_URL || 'http://127.0.0.1:8474',
  primaryNode: {
    id: 'portaldot-val-01',
    rpcEndpoint: 'ws://127.0.0.1:9944',
    proxyName: 'primary-portaldot',
    authoringKey: '0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d'
  },
  backupNode: {
    id: 'portaldot-val-02',
    rpcEndpoint: 'ws://127.0.0.1:9945',
    proxyName: 'backup-portaldot',
    authoringKey: '0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d'
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
      activeConfig.primaryNode.rpcEndpoint = parsed.nodes.primary?.rpc_endpoint || activeConfig.primaryNode.rpcEndpoint;
      activeConfig.primaryNode.proxyName = parsed.nodes.primary?.proxy_name || activeConfig.primaryNode.proxyName;
      activeConfig.primaryNode.authoringKey = parsed.nodes.primary?.authoring_key || activeConfig.primaryNode.authoringKey;

      activeConfig.backupNode.rpcEndpoint = parsed.nodes.backup?.rpc_endpoint || activeConfig.backupNode.rpcEndpoint;
      activeConfig.backupNode.proxyName = parsed.nodes.backup?.proxy_name || activeConfig.backupNode.proxyName;
      activeConfig.backupNode.authoringKey = parsed.nodes.backup?.authoring_key || activeConfig.backupNode.authoringKey;
    }
    if (parsed.toxiproxy?.url) activeConfig.toxiproxyUrl = parsed.toxiproxy.url;
    if (parsed.cluster?.slot_duration_ms) activeConfig.slotDurationMs = parsed.cluster.slot_duration_ms;
    if (parsed.pacemaker?.heartbeat_timeout_ms) activeConfig.pacemaker.heartbeatTimeoutMs = parsed.pacemaker.heartbeat_timeout_ms;
  } catch (err: any) {
    console.error(`Failed to parse validator-setup.yml: ${err.message}`);
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
            data: `🚨 [EQUIVOCATION DETECTED]: Conflicting signatures at Slot #${proof.slotNumber}`
          });
        }
      },
      (logMsg: string) => {
        broadcast({ type: 'log', data: logMsg });
      }
    );
  } catch (err: any) {
    broadcast({ type: 'log', data: `[INIT ERROR] Could not connect to nodes: ${err.message}` });
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

    broadcast({ type: 'log', data: `[CHAOS] Injected ${latency}ms latency on ${cfg.primaryNode.proxyName}` });
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
  console.log(`🛡️  ChaosDot Live Node Controller at http://localhost:${PORT}`);
  console.log(`📡 WebSocket consensus stream connected.`);
  console.log(`======================================================\n`);
});