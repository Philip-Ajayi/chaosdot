export interface SubstrateHeader {
  number: number;
  hash: string;
  parentHash: string;
  stateRoot: string;
  extrinsicsRoot: string;
  slotNumber: number;
  authorPublicKey: string;
  signature: string;
  timestamp: number;
}

export interface EquivocationProof {
  detected: boolean;
  slotNumber: number;
  blockNumber: number;
  validatorPublicKey: string;
  firstHeader: SubstrateHeader;
  secondHeader: SubstrateHeader;
  timestamp: number;
  slashingRisk: 'EXTREME' | 'HIGH' | 'NONE';
  description: string;
}

export interface ToxicConfig {
  name: string;
  type: 'latency' | 'bandwidth' | 'drop' | 'corruption';
  stream: 'upstream' | 'downstream';
  toxicity: number; // 0.0 to 1.0
  attributes: {
    latency?: number;
    jitter?: number;
    rate?: number; // bytes per sec
  };
}

export type ScenarioType =
  | 'stalled-heartbeat'
  | 'split-brain-keystore'
  | 'mempool-backpressure';

export interface ScenarioResult {
  scenarioId: ScenarioType;
  name: string;
  passed: boolean;
  scoreDeduction: number;
  equivocationDetected: boolean;
  blocksEvaluated: number;
  proofs: EquivocationProof[];
  recommendation: string;
  logs: string[];
}

export interface SlashingAuditReport {
  timestamp: string;
  clusterConfig: {
    primaryNode: string;
    backupNode: string;
    targetValidatorKey: string;
    pacemakerLeaseMs: number;
  };
  overallHardeningScore: number;
  verdict: 'CERTIFIED_IMMUNE' | 'CRITICAL_RISK' | 'WARNING';
  scenarioResults: ScenarioResult[];
  remediationPlan: string[];
}
