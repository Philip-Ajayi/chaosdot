import { ToxicConfig } from '../types';

export class ToxiproxyHarness {
  private toxiproxyHost: string;
  private activeToxics: Map<string, ToxicConfig> = new Map();

  constructor(host = 'http://127.0.0.1:8474') {
    this.toxiproxyHost = host.replace(/\/$/, '');
  }

  public setHost(host: string): void {
    this.toxiproxyHost = host.replace(/\/$/, '');
  }

  public async verifyHealth(): Promise<boolean> {
    const res = await fetch(`${this.toxiproxyHost}/version`);
    if (!res.ok) {
      throw new Error(`Toxiproxy health check failed: HTTP ${res.status}`);
    }
    return true;
  }

  public async setProxyEnabled(proxyName: string, enabled: boolean): Promise<void> {
    const res = await fetch(`${this.toxiproxyHost}/proxies/${proxyName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to update proxy status on ${proxyName}: ${err}`);
    }
  }

  public async addToxic(proxyName: string, toxic: ToxicConfig): Promise<void> {
    const res = await fetch(`${this.toxiproxyHost}/proxies/${proxyName}/toxics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toxic)
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Toxiproxy failed to add toxic [${toxic.name}] to ${proxyName}: ${err}`);
    }

    this.activeToxics.set(`${proxyName}-${toxic.name}`, toxic);
  }

  public async removeToxic(proxyName: string, toxicName: string): Promise<void> {
    const res = await fetch(`${this.toxiproxyHost}/proxies/${proxyName}/toxics/${toxicName}`, {
      method: 'DELETE'
    });

    if (!res.ok && res.status !== 404) {
      const err = await res.text();
      throw new Error(`Failed to remove toxic ${toxicName} from ${proxyName}: ${err}`);
    }

    this.activeToxics.delete(`${proxyName}-${toxicName}`);
  }

  public async resetAll(): Promise<void> {
    this.activeToxics.clear();
    const res = await fetch(`${this.toxiproxyHost}/reset`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to reset Toxiproxy state: ${err}`);
    }
  }

  public getActiveToxics(): ToxicConfig[] {
    return Array.from(this.activeToxics.values());
  }
}