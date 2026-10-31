export interface SubstrateHeader {
  number: number;
  hash: string;
  parentHash: string;
  stateRoot: string;
  extrinsicsRoot: string;
  slotNumber: number;
  authorPublicKey: string;
  digestLogs: string[];
  timestamp: number;
}

export interface NodeConfig {
  id: string;
  rpcEndpoint: string;
  proxyName: string;
  authoringKey: string;
}

export interface ValidatorClusterConfig {
  network: string;
  consensus: string;
  slotDurationMs: number;
  simulationMode?: boolean;
  toxiproxyUrl: string;
  primaryNode: NodeConfig;
  backupNode: NodeConfig;
  pacemaker: {
    heartbeatTimeoutMs: number;
    failoverLock: string;
    fencingTokenEnabled: boolean;
  };
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
  type: 'latency' | 'bandwidth' | 'drop' | 'slicer' | 'timeout' | 'reset_peer';
  stream: 'upstream' | 'downstream';
  toxicity: number;
  attributes: Record<string, number | boolean | string>;
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
    toxiproxyUrl: string;
  };
  overallHardeningScore: number;
  verdict: 'CERTIFIED_IMMUNE' | 'CRITICAL_RISK' | 'WARNING';
  scenarioResults: ScenarioResult[];
  remediationPlan: string[];
}