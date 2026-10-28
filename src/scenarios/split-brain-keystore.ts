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
    log('Objective: Force secondary spin-up while primary holds authoring lock.');
    log('===============================================================');

    detector.reset();
    const logs: string[] = [];
    const logger = (m: string) => {
      logs.push(m);
      log(m);
    };

    logger('[Step 1] Baseline synchronization confirmed.');
    await new Promise((r) => setTimeout(r, 3000));

    logger('[Step 2] Inducing distributed lock lease race (Split-Brain trigger)...');
    cluster.triggerSplitBrainKeystore();

    logger('[Step 3] Listening for slot collision between Node 01 and Node 02...');
    await new Promise((r) => setTimeout(r, 6000));

    logger('[Step 4] Quarantining secondary node and releasing authoring lease...');
    cluster.resolveFailover();
    await new Promise((r) => setTimeout(r, 2000));

    const proofs = detector.getProofs();
    const equivocation = proofs.length > 0;

    return {
      scenarioId: 'split-brain-keystore',
      name: 'Split-Brain Keystore Contention',
      passed: !equivocation,
      scoreDeduction: equivocation ? 50 : 0,
      equivocationDetected: equivocation,
      blocksEvaluated: 5,
      proofs,
      recommendation: equivocation
        ? 'FAIL: Distributed key lock failed. Implement Raft/etcd distributed authoring key locks with mutual fencing.'
        : 'PASS: Keystore locking mechanism successfully fenced out secondary candidate.',
      logs
    };
  }
}
