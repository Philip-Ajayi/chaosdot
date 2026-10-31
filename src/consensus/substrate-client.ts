import WebSocket from 'ws';
import { SubstrateHeader } from '../types';
import { SlotDecoder } from './slot-decoder';

export class SubstrateRpcClient {
  private ws: WebSocket | null = null;
  private url: string;
  private onHeaderCallback: ((header: SubstrateHeader) => void) | null = null;
  private isConnected = false;
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
  private defaultAuthorKey: string;

  constructor(url: string, defaultAuthorKey = '') {
    this.url = url;
    this.defaultAuthorKey = defaultAuthorKey;
  }

  public getEndpoint(): string {
    return this.url;
  }

  public connect(onHeader: (header: SubstrateHeader) => void): Promise<void> {
    this.onHeaderCallback = onHeader;

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

              // Query canonical block hash from node RPC
              let canonicalHash = r.hash;
              if (!canonicalHash) {
                try {
                  canonicalHash = await this.call('chain_getBlockHash', [blockNumber]);
                } catch {
                  canonicalHash = `0x0000000000000000000000000000000000000000000000000000000000000000`;
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
          } catch (e) {
            // Invalid packet
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

  public call(method: string, params: any[] = []): Promise<any> {
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
      this.isConnected = false;
      this.ws = null;
    }
  }

  public active(): boolean {
    return this.isConnected;
  }
}