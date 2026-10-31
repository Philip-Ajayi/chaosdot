import WebSocket from 'ws';
import { SubstrateHeader } from '../types';
import { SlotDecoder } from './slot-decoder';

export class SubstrateRpcClient {
  private ws: WebSocket | null = null;
  private url: string;
  private onHeaderCallback: ((header: SubstrateHeader) => void) | null = null;
  private isConnected = false;
  private isSimulated = false;
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
  private defaultAuthorKey: string;
  private simulatedLatencyMs = 0;

  constructor(url: string, defaultAuthorKey = '', simulated = false) {
    this.url = url;
    this.defaultAuthorKey = defaultAuthorKey;
    this.isSimulated = simulated;
  }

  public setSimulated(simulated: boolean): void {
    this.isSimulated = simulated;
  }

  public setSimulatedLatency(ms: number): void {
    this.simulatedLatencyMs = ms;
  }

  public getEndpoint(): string {
    return this.url;
  }

  public connect(onHeader: (header: SubstrateHeader) => void): Promise<void> {
    this.onHeaderCallback = onHeader;

    if (this.isSimulated) {
      this.isConnected = true;
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.on('open', () => {
          this.isConnected = true;
          this.subscribeNewHeads();
          resolve();
        });

        this.ws.on('message', async (data: WebSocket.Data) => {
          try {
            const parsed = JSON.parse(data.toString());

            if (parsed.id && this.pendingRequests.has(parsed.id)) {
              const promise = this.pendingRequests.get(parsed.id)!;
              this.pendingRequests.delete(parsed.id);
              if (parsed.error) promise.reject(new Error(parsed.error.message));
              else promise.resolve(parsed.result);
              return;
            }

            if (parsed.method === 'chain_newHead' && parsed.params && parsed.params.result) {
              const r = parsed.params.result;
              const blockNumber = typeof r.number === 'string' ? parseInt(r.number, 16) : Number(r.number);
              const logs: string[] = r.digest && r.digest.logs ? r.digest.logs : [];
              const slot = SlotDecoder.extractSlot(logs);

              let canonicalHash = r.hash;
              if (!canonicalHash) {
                try {
                  canonicalHash = await this.call('chain_getBlockHash', [blockNumber]);
                } catch {
                  canonicalHash = `0x${'0'.repeat(64)}`;
                }
              }

              const header: SubstrateHeader = {
                number: blockNumber,
                hash: canonicalHash,
                parentHash: r.parentHash,
                stateRoot: r.stateRoot,
                extrinsicsRoot: r.extrinsicsRoot,
                slotNumber: slot,
                authorPublicKey: this.defaultAuthorKey || '0xUNKNOWN',
                digestLogs: logs,
                timestamp: Date.now()
              };

              if (this.onHeaderCallback) {
                this.onHeaderCallback(header);
              }
            }
          } catch {
            // Ignore malformed packets
          }
        });

        this.ws.on('error', (err) => {
          this.isConnected = false;
          reject(new Error(`WebSocket connection failed for ${this.url}: ${err.message}`));
        });

        this.ws.on('close', () => {
          this.isConnected = false;
        });
      } catch (err: any) {
        reject(new Error(`Failed to initialize WebSocket client for ${this.url}: ${err.message}`));
      }
    });
  }

  public async call(method: string, params: any[] = []): Promise<any> {
    if (this.simulatedLatencyMs > 0) {
      await new Promise((r) => setTimeout(r, this.simulatedLatencyMs));
    }

    if (this.isSimulated) {
      if (method === 'system_health') {
        return { isSyncing: false, peers: 12, shouldHavePeers: true };
      }
      if (method === 'chain_getBlockHash') {
        return `0x${Math.random().toString(16).padEnd(66, 'a').slice(2, 66)}`;
      }
      return { status: 'success', method, params };
    }

    return new Promise((resolve, reject) => {
      if (!this.ws || !this.isConnected) {
        return reject(new Error(`WebSocket RPC is not connected to ${this.url}`));
      }
      const id = ++this.requestId;
      this.pendingRequests.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  private subscribeNewHeads(): void {
    if (!this.ws || !this.isConnected) return;
    const req = {
      jsonrpc: '2.0',
      id: ++this.requestId,
      method: 'chain_subscribeNewHeads',
      params: []
    };
    this.ws.send(JSON.stringify(req));
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  public active(): boolean {
    return this.isConnected;
  }
}