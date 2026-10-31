import { ScenarioResult } from '../types';
import { VirtualPortaldotCluster } from '../consensus/virtual-portaldot-cluster';
import { EquivocationDetector } from '../consensus/equivocation-detector';

export class MempoolBackpressureScenario {
  public static async run(
    cluster: VirtualPortaldotCluster,
    detector: EquivocationDetector,
    log: (msg: string) => void
  ): Promise<ScenarioResult> {
    log('===============================================================');
    log('SCENARIO 3: Mempool Backpressure & Live RPC Flooding');
    log('===============================================================');

    detector.reset();
    const logs: string[] = [];
    const logger = (m: string) => {
      logs.push(m);
      log(m);
    };

    const primaryClient = cluster.getPrimaryClient();
    const toxiproxy = cluster.getToxiproxy();
    const primaryProxyName = cluster.getConfig().primaryNode.proxyName;

    logger('[Step 1] Injecting 1500ms network latency onto Primary RPC via Toxiproxy...');
    await toxiproxy.addToxic(primaryProxyName, {
      name: 'rpc-latency-burst',
      type: 'latency',
      stream: 'upstream',
      toxicity: 1.0,
      attributes: { latency: 1500, jitter: 100 }
    });

    logger('[Step 2] Sending concurrent RPC requests to live node...');
    const startTime = Date.now();
    const calls = Array.from({ length: 25 }, () =>
      primaryClient.call('system_health', []).catch((e) => ({ error: e.message }))
    );

    const results = await Promise.all(calls);
    const roundTrip = Date.now() - startTime;
    logger(`[Step 3] Evaluated 25 live RPC queries in ${roundTrip}ms. Parsing response fidelity...`);

    const failures = results.filter((r) => r && r.error).length;
    logger(`Live RPC error count: ${failures} / 25`);

    await toxiproxy.removeToxic(primaryProxyName, 'rpc-latency-burst');

    const proofs = detector.getProofs();
    const passed = proofs.length === 0 && failures < 10;

    return {
      scenarioId: 'mempool-backpressure',
      name: 'Mempool Backpressure & RPC Flooding',
      passed,
      scoreDeduction: passed ? 0 : 15,
      equivocationDetected: proofs.length > 0,
      blocksEvaluated: results.length,
      proofs,
      recommendation: passed
        ? 'Authoring RPC pipeline remained available under latency backpressure.'
        : 'Node RPC queue was saturated. Increase RPC pool capacity.',
      logs
    };
  }
}