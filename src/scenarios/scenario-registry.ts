import { ScenarioResult, SlashingAuditReport } from '../types';
import { VirtualPortaldotCluster } from '../consensus/virtual-portaldot-cluster';
import { EquivocationDetector } from '../consensus/equivocation-detector';
import { StalledHeartbeatScenario } from './stalled-heartbeat';
import { SplitBrainKeystoreScenario } from './split-brain-keystore';
import { MempoolBackpressureScenario } from './mempool-backpressure';

export class ScenarioRegistry {
  public static async runAll(
    cluster: VirtualPortaldotCluster,
    detector: EquivocationDetector,
    log: (msg: string) => void
  ): Promise<SlashingAuditReport> {
    const results: ScenarioResult[] = [];

    const res1 = await StalledHeartbeatScenario.run(cluster, detector, log);
    results.push(res1);

    const res2 = await SplitBrainKeystoreScenario.run(cluster, detector, log);
    results.push(res2);

    const res3 = await MempoolBackpressureScenario.run(cluster, detector, log);
    results.push(res3);

    // Compute Hardening Score (Base 100)
    let score = 100;
    const recommendations: string[] = [];

    for (const res of results) {
      score -= res.scoreDeduction;
      if (res.recommendation) {
        recommendations.push(res.recommendation);
      }
    }

    if (score < 0) score = 0;

    const verdict = score >= 90 ? 'CERTIFIED_IMMUNE' : score >= 60 ? 'WARNING' : 'CRITICAL_RISK';

    return {
      timestamp: new Date().toISOString(),
      clusterConfig: {
        primaryNode: 'portaldot-primary-01.internal',
        backupNode: 'portaldot-backup-02.internal',
        targetValidatorKey: '0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d',
        pacemakerLeaseMs: 6000
      },
      overallHardeningScore: score,
      verdict,
      scenarioResults: results,
      remediationPlan: recommendations
    };
  }
}
