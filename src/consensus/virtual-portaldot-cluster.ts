import { SubstrateRpcClient } from './substrate-client';
import { ToxiproxyHarness } from '../faults/toxiproxy-harness';
import { SubstrateHeader, ValidatorClusterConfig } from '../types';

export class VirtualPortaldotCluster {
  private config: ValidatorClusterConfig;
  private primaryClient: SubstrateRpcClient;
  private backupClient: SubstrateRpcClient;
  private toxiproxy: ToxiproxyHarness;
  private primaryHeight = 0;
  private backupHeight = 0;
  private primarySlot = 0;
  private backupSlot = 0;
  private primaryStalled = false;
  private backupStalled = false;
  private onBlockCallback: ((header: SubstrateHeader, source: string) => void) | null = null;
  private onLogCallback: ((msg: string) => void) | null = null;

  constructor(customConfig?: Partial<ValidatorClusterConfig>) {
    this.config = {
      network: customConfig?.network || 'portaldot-live',
      consensus: customConfig?.consensus || 'AURA-BABE',
      slotDurationMs: customConfig?.slotDurationMs || 6000,
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

    this.toxiproxy = new ToxiproxyHarness(this.config.toxiproxyUrl);
    this.primaryClient = new SubstrateRpcClient(this.config.primaryNode.rpcEndpoint, this.config.primaryNode.authoringKey);
    this.backupClient = new SubstrateRpcClient(this.config.backupNode.rpcEndpoint, this.config.backupNode.authoringKey);
  }

  public updateConfig(newConfig: ValidatorClusterConfig): void {
    this.stop();
    this.config = newConfig;
    this.toxiproxy.setHost(newConfig.toxiproxyUrl);
    this.primaryClient = new SubstrateRpcClient(newConfig.primaryNode.rpcEndpoint, newConfig.primaryNode.authoringKey);
    this.backupClient = new SubstrateRpcClient(newConfig.backupNode.rpcEndpoint, newConfig.backupNode.authoringKey);
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
    this.primaryClient.disconnect();
    this.backupClient.disconnect();
    this.log('Disconnected from live cluster nodes.');
  }

  public async injectStall(nodeRole: 'PRIMARY' | 'BACKUP', stall: boolean): Promise<void> {
    const target = nodeRole === 'PRIMARY' ? this.config.primaryNode : this.config.backupNode;
    await this.toxiproxy.setProxyEnabled(target.proxyName, !stall);

    if (nodeRole === 'PRIMARY') {
      this.primaryStalled = stall;
    } else {
      this.backupStalled = stall;
    }
    this.log(`Egress on ${target.id} (${target.proxyName}): ${stall ? 'SEVERED' : 'RESTORED'}`);
  }

  public async triggerSplitBrainKeystore(): Promise<void> {
    this.log('Severing Primary peer gossip proxy while authoring RPC remains active...');
    await this.injectStall('PRIMARY', true);

    setTimeout(async () => {
      this.log('Re-establishing Primary network path. Observing live authoring race condition...');
      await this.injectStall('PRIMARY', false);
    }, 2000);
  }

  public async resolveFailover(): Promise<void> {
    await this.toxiproxy.resetAll();
    this.primaryStalled = false;
    this.backupStalled = false;
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
    return {
      primary: {
        id: this.config.primaryNode.id,
        height: this.primaryHeight,
        slot: this.primarySlot,
        active: this.primaryClient.active(),
        stalled: this.primaryStalled
      },
      backup: {
        id: this.config.backupNode.id,
        height: this.backupHeight,
        slot: this.backupSlot,
        active: this.backupClient.active(),
        stalled: this.backupStalled
      }
    };
  }
}