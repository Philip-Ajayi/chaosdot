import { ScenarioResult } from '../types';
import { VirtualPortaldotCluster } from '../consensus/virtual-portaldot-cluster';
import { EquivocationDetector } from '../consensus/equivocation-detector';

export class SplitBrainKeystoreScenario {
  public static async run(
    cluster: VirtualPortaldotCluster,
    detector: EquivocationDetector,
    log: (msg: string) => void
  ): Promise<ScenarioResult> {
    log('===============================================================');
    log('SCENARIO 2: Split-Brain Keystore (Dual Concurrent Authors)');
    log('===============================================================');

    detector.reset();
    const logs: string[] = [];
    const logger = (m: string) => {
      logs.push(m);
      log(m);
    };

    logger('[Step 1] Priming both live nodes...');
    await cluster.resolveFailover();

    logger('[Step 2] Triggering split-brain partition race via Toxiproxy...');
    await cluster.triggerSplitBrainKeystore();

    logger('[Step 3] Listening for live equivocation collisions on active slots...');
    await new Promise((r) => setTimeout(r, cluster.getConfig().slotDurationMs * 2));

    logger('[Step 4] Normalizing routes...');
    await cluster.resolveFailover();

    const proofs = detector.getProofs();
    const equivocation = proofs.length > 0;

    return {
      scenarioId: 'split-brain-keystore',
      name: 'Split-Brain Keystore Contention',
      passed: !equivocation,
      scoreDeduction: equivocation ? 50 : 0,
      equivocationDetected: equivocation,
      blocksEvaluated: proofs.length > 0 ? 2 : 1,
      proofs,
      recommendation: equivocation
        ? 'FAIL: Distributed key lock failed. Implement Raft or etcd key fencing leases.'
        : 'PASS: Keystore locking successfully prevented dual signing.',
      logs
    };
  }
}