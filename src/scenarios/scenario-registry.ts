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
    const config = cluster.getConfig();

    return {
      timestamp: new Date().toISOString(),
      clusterConfig: {
        primaryNode: config.primaryNode.rpcEndpoint,
        backupNode: config.backupNode.rpcEndpoint,
        targetValidatorKey: config.primaryNode.authoringKey,
        pacemakerLeaseMs: config.pacemaker.heartbeatTimeoutMs,
        toxiproxyUrl: config.toxiproxyUrl
      },
      overallHardeningScore: score,
      verdict,
      scenarioResults: results,
      remediationPlan: recommendations
    };
  }
}