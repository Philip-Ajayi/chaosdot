import crypto from 'crypto';
import { SubstrateRpcClient } from './substrate-client';
import { ToxiproxyHarness } from '../faults/toxiproxy-harness';
import { SlotDecoder } from './slot-decoder';
import { SubstrateHeader, ValidatorClusterConfig } from '../types';

export class VirtualPortaldotCluster {
  private config: ValidatorClusterConfig;
  private primaryClient: SubstrateRpcClient;
  private backupClient: SubstrateRpcClient;
  private toxiproxy: ToxiproxyHarness;
  private primaryHeight = 100;
  private backupHeight = 100;
  private primarySlot = 1000;
  private backupSlot = 1000;
  private primaryStalled = false;
  private backupStalled = false;
  private simulationTimer: NodeJS.Timeout | null = null;
  private stallTimestamp = 0;
  private lastBlockHash = `0x${crypto.randomBytes(32).toString('hex')}`;
  private onBlockCallback: ((header: SubstrateHeader, source: string) => void) | null = null;
  private onLogCallback: ((msg: string) => void) | null = null;

  constructor(customConfig?: Partial<ValidatorClusterConfig>) {
    const simMode = customConfig?.simulationMode !== undefined 
      ? Boolean(customConfig.simulationMode) 
      : true;

    this.config = {
      network: customConfig?.network || 'portaldot-live',
      consensus: customConfig?.consensus || 'AURA-BABE',
      slotDurationMs: customConfig?.slotDurationMs || 3000,
      simulationMode: simMode,
      toxiproxyUrl: customConfig?.toxiproxyUrl || 'http://127.0.0.1:8474',
      primaryNode: customConfig?.primaryNode || {
        id: 'portaldot-val-01',
        rpcEndpoint: 'ws://127.0.0.1:9944',
        proxyName: 'primary-portaldot',
        authoringKey: '0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d'
      },
      backupNode: customConfig?.backupNode || {
        id: 'portaldot-val-02',
        rpcEndpoint: 'ws://127.0.0.1:9945',
        proxyName: 'backup-portaldot',
        authoringKey: '0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d'
      },
      pacemaker: customConfig?.pacemaker || {
        heartbeatTimeoutMs: 6000,
        failoverLock: 'raft',
        fencingTokenEnabled: true
      }
    };

    const isSim = Boolean(this.config.simulationMode);
    this.toxiproxy = new ToxiproxyHarness(this.config.toxiproxyUrl);
    this.toxiproxy.setVirtualMode(isSim);

    this.primaryClient = new SubstrateRpcClient(
      this.config.primaryNode.rpcEndpoint,
      this.config.primaryNode.authoringKey,
      isSim
    );
    this.backupClient = new SubstrateRpcClient(
      this.config.backupNode.rpcEndpoint,
      this.config.backupNode.authoringKey,
      isSim
    );
  }

  public updateConfig(newConfig: ValidatorClusterConfig): void {
    this.stop();
    this.config = newConfig;

    const isSim = Boolean(newConfig.simulationMode);
    this.toxiproxy.setHost(newConfig.toxiproxyUrl);
    this.toxiproxy.setVirtualMode(isSim);

    this.primaryClient = new SubstrateRpcClient(
      newConfig.primaryNode.rpcEndpoint,
      newConfig.primaryNode.authoringKey,
      isSim
    );
    this.backupClient = new SubstrateRpcClient(
      newConfig.backupNode.rpcEndpoint,
      newConfig.backupNode.authoringKey,
      isSim
    );
  }

  public getConfig(): ValidatorClusterConfig {
    return this.config;
  }

  public async start(
    onBlock: (header: SubstrateHeader, source: string) => void,
    onLog: (msg: string) => void
  ): Promise<void> {
    this.onBlockCallback = onBlock;
    this.onLogCallback = onLog;

    if (Boolean(this.config.simulationMode)) {
      this.log('🛡️ Initialized Virtual Substrate Consensus Engine (Standalone Simulation Mode).');
      this.startSimulationTicker();
      return;
    }

    this.log(`Connecting to live primary node: ${this.config.primaryNode.rpcEndpoint}...`);
    await this.primaryClient.connect((header) => {
      this.primaryHeight = header.number;
      this.primarySlot = header.slotNumber;
      this.log(`[PRIMARY:01] Proposed Block #${header.number} [Slot #${header.slotNumber}] Hash: ${header.hash}`);
      if (this.onBlockCallback) this.onBlockCallback(header, this.config.primaryNode.id);
    });

    this.log(`Connecting to live backup node: ${this.config.backupNode.rpcEndpoint}...`);
    await this.backupClient.connect((header) => {
      this.backupHeight = header.number;
      this.backupSlot = header.slotNumber;
      this.log(`[BACKUP:02] Proposed Block #${header.number} [Slot #${header.slotNumber}] Hash: ${header.hash}`);
      if (this.onBlockCallback) this.onBlockCallback(header, this.config.backupNode.id);
    });

    this.log('Connected to live cluster nodes.');
  }

  public stop(): void {
    if (this.simulationTimer) {
      clearInterval(this.simulationTimer);
      this.simulationTimer = null;
    }
    this.primaryClient.disconnect();
    this.backupClient.disconnect();
    this.log('Cluster stopped.');
  }

  private startSimulationTicker(): void {
    if (this.simulationTimer) clearInterval(this.simulationTimer);

    this.simulationTimer = setInterval(() => {
      this.primarySlot++;
      this.backupSlot = this.primarySlot;

      const auraDigest = SlotDecoder.encodeAuraDigest(this.primarySlot);
      const isPrimaryAuthoring = !this.primaryStalled;
      const isBackupActive = this.primaryStalled && Date.now() - this.stallTimestamp > this.config.pacemaker.heartbeatTimeoutMs;

      if (isPrimaryAuthoring) {
        this.primaryHeight++;
        const newHash = `0x${crypto.randomBytes(32).toString('hex')}`;
        const header: SubstrateHeader = {
          number: this.primaryHeight,
          hash: newHash,
          parentHash: this.lastBlockHash,
          stateRoot: `0x${crypto.randomBytes(32).toString('hex')}`,
          extrinsicsRoot: `0x${crypto.randomBytes(32).toString('hex')}`,
          slotNumber: this.primarySlot,
          authorPublicKey: this.config.primaryNode.authoringKey,
          digestLogs: [auraDigest],
          timestamp: Date.now()
        };
        this.lastBlockHash = newHash;
        this.log(`[PRIMARY:01] Proposed Block #${header.number} [Slot #${header.slotNumber}] Hash: ${header.hash.substring(0, 14)}...`);
        if (this.onBlockCallback) this.onBlockCallback(header, this.config.primaryNode.id);
      } else if (isBackupActive) {
        this.backupHeight++;
        const newHash = `0x${crypto.randomBytes(32).toString('hex')}`;
        const header: SubstrateHeader = {
          number: this.backupHeight,
          hash: newHash,
          parentHash: this.lastBlockHash,
          stateRoot: `0x${crypto.randomBytes(32).toString('hex')}`,
          extrinsicsRoot: `0x${crypto.randomBytes(32).toString('hex')}`,
          slotNumber: this.backupSlot,
          authorPublicKey: this.config.backupNode.authoringKey,
          digestLogs: [auraDigest],
          timestamp: Date.now()
        };
        this.lastBlockHash = newHash;
        this.log(`[BACKUP:02] Failover Acquired! Proposed Block #${header.number} [Slot #${header.slotNumber}] Hash: ${header.hash.substring(0, 14)}...`);
        if (this.onBlockCallback) this.onBlockCallback(header, this.config.backupNode.id);
      }
    }, this.config.slotDurationMs);
  }

  public async injectStall(nodeRole: 'PRIMARY' | 'BACKUP', stall: boolean): Promise<void> {
    const target = nodeRole === 'PRIMARY' ? this.config.primaryNode : this.config.backupNode;
    await this.toxiproxy.setProxyEnabled(target.proxyName, !stall);

    if (nodeRole === 'PRIMARY') {
      this.primaryStalled = stall;
      if (stall) this.stallTimestamp = Date.now();
    } else {
      this.backupStalled = stall;
    }
    this.log(`Egress on ${target.id} (${target.proxyName}): ${stall ? 'SEVERED' : 'RESTORED'}`);
  }

  public async triggerSplitBrainKeystore(): Promise<void> {
    this.log('Severing network partition lock. Inducing concurrent keystore authoring...');

    const collisionSlot = this.primarySlot + 1;
    this.primarySlot = collisionSlot;
    this.backupSlot = collisionSlot;
    const auraDigest = SlotDecoder.encodeAuraDigest(collisionSlot);

    const primaryBlockNumber = ++this.primaryHeight;
    const backupBlockNumber = ++this.backupHeight;

    const headerPrimary: SubstrateHeader = {
      number: primaryBlockNumber,
      hash: `0x1111${crypto.randomBytes(30).toString('hex')}`,
      parentHash: this.lastBlockHash,
      stateRoot: '0x00',
      extrinsicsRoot: '0x00',
      slotNumber: collisionSlot,
      authorPublicKey: this.config.primaryNode.authoringKey,
      digestLogs: [auraDigest],
      timestamp: Date.now()
    };

    const headerBackup: SubstrateHeader = {
      number: backupBlockNumber,
      hash: `0x2222${crypto.randomBytes(30).toString('hex')}`,
      parentHash: this.lastBlockHash,
      stateRoot: '0x00',
      extrinsicsRoot: '0x00',
      slotNumber: collisionSlot,
      authorPublicKey: this.config.backupNode.authoringKey,
      digestLogs: [auraDigest],
      timestamp: Date.now()
    };

    if (this.onBlockCallback) {
      this.onBlockCallback(headerPrimary, this.config.primaryNode.id);
      this.onBlockCallback(headerBackup, this.config.backupNode.id);
    }
  }

  public async resolveFailover(): Promise<void> {
    await this.toxiproxy.resetAll();
    this.primaryStalled = false;
    this.backupStalled = false;
    this.primaryClient.setSimulatedLatency(0);
    this.log('Network routes reset. Normal topology restored.');
  }

  public getPrimaryClient(): SubstrateRpcClient {
    return this.primaryClient;
  }

  public getBackupClient(): SubstrateRpcClient {
    return this.backupClient;
  }

  public getToxiproxy(): ToxiproxyHarness {
    return this.toxiproxy;
  }

  private log(msg: string): void {
    if (this.onLogCallback) {
      this.onLogCallback(`[LIVE-CLUSTER] ${msg}`);
    }
  }

  public getStatus() {
    const isSim = Boolean(this.config.simulationMode);
    return {
      simulationMode: isSim,
      primary: {
        id: this.config.primaryNode.id,
        height: this.primaryHeight,
        slot: this.primarySlot,
        active: isSim ? !this.primaryStalled : this.primaryClient.active(),
        stalled: this.primaryStalled
      },
      backup: {
        id: this.config.backupNode.id,
        height: this.backupHeight,
        slot: this.backupSlot,
        active: isSim ? true : this.backupClient.active(),
        stalled: this.backupStalled
      }
    };
  }
}