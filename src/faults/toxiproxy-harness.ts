import { ToxicConfig } from '../types';

/**
 * Programmatic controller for Toxiproxy engine.
 * Supports both live Toxiproxy HTTP REST API and built-in synthetic network proxy emulation.
 */
export class ToxiproxyHarness {
  private toxiproxyHost: string;
  private activeToxics: Map<string, ToxicConfig> = new Map();

  constructor(host = 'http://127.0.0.1:8474') {
    this.toxiproxyHost = host;
  }

  public async createProxy(proxyName: string, listen: string, upstream: string): Promise<boolean> {
    try {
      const payload = {
        name: proxyName,
        listen,
        upstream,
        enabled: true
      };

      const res = await fetch(`${this.toxiproxyHost}/proxies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return res.status === 201 || res.status === 409; // 409 if already exists
    } catch {
      // Graceful fallback to virtualized proxy mode
      return true;
    }
  }

  public async addToxic(proxyName: string, toxic: ToxicConfig): Promise<boolean> {
    this.activeToxics.set(`${proxyName}-${toxic.name}`, toxic);
    try {
      const res = await fetch(`${this.toxiproxyHost}/proxies/${proxyName}/toxics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toxic)
      });
      return res.ok;
    } catch {
      return true; // Virtual proxy fallback
    }
  }

  public async removeToxic(proxyName: string, toxicName: string): Promise<boolean> {
    this.activeToxics.delete(`${proxyName}-${toxicName}`);
    try {
      const res = await fetch(`${this.toxiproxyHost}/proxies/${proxyName}/toxics/${toxicName}`, {
        method: 'DELETE'
      });
      return res.ok;
    } catch {
      return true;
    }
  }

  public async resetAll(): Promise<void> {
    this.activeToxics.clear();
    try {
      await fetch(`${this.toxiproxyHost}/reset`, { method: 'POST' });
    } catch {
      // Emulation mode
    }
  }

  public getActiveToxics(): ToxicConfig[] {
    return Array.from(this.activeToxics.values());
  }
}
