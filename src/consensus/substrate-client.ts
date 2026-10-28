import WebSocket from 'ws';
import { SubstrateHeader } from '../types';

export class SubstrateRpcClient {
  private ws: WebSocket | null = null;
  private url: string;
  private onHeaderCallback: ((header: SubstrateHeader) => void) | null = null;
  private isConnected = false;

  constructor(url: string) {
    this.url = url;
  }

  public connect(onHeader: (header: SubstrateHeader) => void): Promise<void> {
    this.onHeaderCallback = onHeader;
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.on('open', () => {
          this.isConnected = true;
          // Subscribe to new block heads in Substrate JSON-RPC
          const subscribeMsg = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'chain_subscribeNewHeads',
            params: []
          });
          this.ws?.send(subscribeMsg);
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          try {
            const parsed = JSON.parse(data.toString());
            if (parsed.params && parsed.params.result) {
              const r = parsed.params.result;
              const header: SubstrateHeader = {
                number: parseInt(r.number, 16) || r.number || 0,
                hash: r.hash || `0x${Math.random().toString(16).substring(2, 66).padEnd(64, '0')}`,
                parentHash: r.parentHash || '0x0000000000000000000000000000000000000000000000000000000000000000',
                stateRoot: r.stateRoot || '0x00',
                extrinsicsRoot: r.extrinsicsRoot || '0x00',
                slotNumber: r.slotNumber || Math.floor(Date.now() / 6000),
                authorPublicKey: r.author || '0xAliceDefaultValidatorKey11111111111111111111111111111111',
                signature: r.signature || '0xsig',
                timestamp: Date.now()
              };
              if (this.onHeaderCallback) {
                this.onHeaderCallback(header);
              }
            }
          } catch {
            // Non-JSON or handshake packet
          }
        });

        this.ws.on('error', (err) => {
          this.isConnected = false;
          reject(err);
        });

        this.ws.on('close', () => {
          this.isConnected = false;
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.isConnected = false;
    }
  }

  public active(): boolean {
    return this.isConnected;
  }
}
