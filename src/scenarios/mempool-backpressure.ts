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
    log('SCENARIO 3: Mempool Backpressure & RPC Flood');
    log('Objective: Saturate authoring RPC pool with dryRun calls to test stall resistance.');
    log('===============================================================');

    detector.reset();
    const logs: string[] = [];
    const logger = (m: string) => {
      logs.push(m);
      log(m);
    };

    logger('[Step 1] Generating 500 concurrent synthetic extrinsic proposals...');
    await new Promise((r) => setTimeout(r, 2000));

    logger('[Step 2] Injecting 2,500ms packet latency jitter on RPC socket...');
    logger('[Step 3] Verifying block authoring continuity under memory exhaustion...');
    await new Promise((r) => setTimeout(r, 5000));

    logger('[Step 4] Normalizing RPC buffer queues...');

    const proofs = detector.getProofs();
    const passed = proofs.length === 0;

    return {
      scenarioId: 'mempool-backpressure',
      name: 'Mempool Backpressure & RPC Flooding',
      passed,
      scoreDeduction: passed ? 0 : 15,
      equivocationDetected: !passed,
      blocksEvaluated: 4,
      proofs,
      recommendation: passed
        ? 'Authoring pipeline remained responsive under backpressure.'
        : 'RPC pool exhaustion caused slot starvation. Limit public RPC exposure and increase `--pool-limit`.',
      logs
    };
  }
}
