import { ScenarioResult } from '../types';
import { VirtualPortaldotCluster } from '../consensus/virtual-portaldot-cluster';
import { EquivocationDetector } from '../consensus/equivocation-detector';

export class StalledHeartbeatScenario {
  public static async run(
    cluster: VirtualPortaldotCluster,
    detector: EquivocationDetector,
    log: (msg: string) => void
  ): Promise<ScenarioResult> {
    log('===============================================================');
    log('SCENARIO 1: Stalled Heartbeat (Egress Dropout at Session Boundary)');
    log('Objective: Verify pacemaker timeout prevents premature takeover.');
    log('===============================================================');

    detector.reset();
    const logs: string[] = [];
    const logger = (m: string) => {
      logs.push(m);
      log(m);
    };

    logger('[Step 1] Baseline operational state: 2 consecutive slot cycles.');
    await new Promise((r) => setTimeout(r, 4000));

    logger('[Step 2] Severing network egress on Primary Validator (Toxiproxy packet cut)...');
    cluster.injectStall('PRIMARY', true);

    logger('[Step 3] Monitoring backup heartbeat auditor for 6000ms...');
    await new Promise((r) => setTimeout(r, 6000));

    logger('[Step 4] Restoring primary egress before pacemaker timeout expires...');
    cluster.injectStall('PRIMARY', false);
    await new Promise((r) => setTimeout(r, 3000));

    const proofs = detector.getProofs();
    const passed = proofs.length === 0;

    return {
      scenarioId: 'stalled-heartbeat',
      name: 'Stalled Heartbeat Session Cut',
      passed,
      scoreDeduction: passed ? 0 : 25,
      equivocationDetected: !passed,
      blocksEvaluated: 6,
      proofs,
      recommendation: passed
        ? 'Pacemaker grace interval is adequate. No premature secondary signing occurred.'
        : 'CRITICAL: Increase pacemaker failover threshold from 6000ms to 12000ms in validator-setup.yml.',
      logs
    };
  }
}
