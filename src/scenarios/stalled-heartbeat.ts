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
    log('===============================================================');

    detector.reset();
    const logs: string[] = [];
    const logger = (m: string) => {
      logs.push(m);
      log(m);
    };

    const cfg = cluster.getConfig();
    logger(`[Step 1] Verifying live primary RPC connection at ${cfg.primaryNode.rpcEndpoint}...`);

    await cluster.getPrimaryClient().call('system_health', []);
    logger('[Step 2] Primary node RPC is responsive. Severing egress via Toxiproxy...');

    await cluster.injectStall('PRIMARY', true);

    const waitMs = cfg.pacemaker.heartbeatTimeoutMs;
    logger(`[Step 3] Monitoring cluster for ${waitMs}ms across failover window...`);
    await new Promise((r) => setTimeout(r, waitMs));

    logger('[Step 4] Restoring primary network egress...');
    await cluster.injectStall('PRIMARY', false);

    const proofs = detector.getProofs();
    const passed = proofs.length === 0;

    return {
      scenarioId: 'stalled-heartbeat',
      name: 'Stalled Heartbeat Session Cut',
      passed,
      scoreDeduction: passed ? 0 : 25,
      equivocationDetected: !passed,
      blocksEvaluated: proofs.length > 0 ? 2 : 1,
      proofs,
      recommendation: passed
        ? 'Pacemaker grace interval held. Backup node did not author concurrently.'
        : `CRITICAL: Pacemaker timeout threshold (${waitMs}ms) is too aggressive. Increase heartbeat_timeout_ms.`,
      logs
    };
  }
}