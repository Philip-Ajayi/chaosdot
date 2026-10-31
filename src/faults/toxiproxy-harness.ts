import { ToxicConfig } from '../types';

export class ToxiproxyHarness {
  private toxiproxyHost: string;
  private activeToxics: Map<string, ToxicConfig> = new Map();
  private isVirtual = false;
  private virtualProxies: Map<string, { enabled: boolean }> = new Map();

  constructor(host = 'http://127.0.0.1:8474') {
    this.toxiproxyHost = host.replace(/\/$/, '');
  }

  public setHost(host: string): void {
    this.toxiproxyHost = host.replace(/\/$/, '');
  }

  public setVirtualMode(virtual?: boolean): void {
    this.isVirtual = Boolean(virtual);
  }

  public async verifyHealth(): Promise<boolean> {
    if (this.isVirtual) return true;
    try {
      const res = await fetch(`${this.toxiproxyHost}/version`);
      return res.ok;
    } catch {
      this.isVirtual = true;
      return false;
    }
  }

  public async setProxyEnabled(proxyName: string, enabled: boolean): Promise<void> {
    this.virtualProxies.set(proxyName, { enabled });
    if (this.isVirtual) return;

    try {
      const res = await fetch(`${this.toxiproxyHost}/proxies/${proxyName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      if (!res.ok) {
        this.isVirtual = true;
      }
    } catch {
      this.isVirtual = true;
    }
  }

  public async addToxic(proxyName: string, toxic: ToxicConfig): Promise<void> {
    this.activeToxics.set(`${proxyName}-${toxic.name}`, toxic);
    if (this.isVirtual) return;

    try {
      const res = await fetch(`${this.toxiproxyHost}/proxies/${proxyName}/toxics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toxic)
      });
      if (!res.ok) {
        this.isVirtual = true;
      }
    } catch {
      this.isVirtual = true;
    }
  }

  public async removeToxic(proxyName: string, toxicName: string): Promise<void> {
    this.activeToxics.delete(`${proxyName}-${toxicName}`);
    if (this.isVirtual) return;

    try {
      await fetch(`${this.toxiproxyHost}/proxies/${proxyName}/toxics/${toxicName}`, {
        method: 'DELETE'
      });
    } catch {
      this.isVirtual = true;
    }
  }

  public async resetAll(): Promise<void> {
    this.activeToxics.clear();
    this.virtualProxies.clear();
    if (this.isVirtual) return;

    try {
      await fetch(`${this.toxiproxyHost}/reset`, { method: 'POST' });
    } catch {
      this.isVirtual = true;
    }
  }

  public getToxic(proxyName: string, type: string): ToxicConfig | undefined {
    for (const [key, toxic] of this.activeToxics.entries()) {
      if (key.startsWith(proxyName) && toxic.type === type) {
        return toxic;
      }
    }
    return undefined;
  }

  public getActiveToxics(): ToxicConfig[] {
    return Array.from(this.activeToxics.values());
  }

  public isProxyEnabled(proxyName: string): boolean {
    const p = this.virtualProxies.get(proxyName);
    return p !== undefined ? p.enabled : true;
  }
}