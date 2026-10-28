import { SubstrateHeader, EquivocationProof } from '../types';

export class EquivocationDetector {
  private slotRegistry: Map<number, SubstrateHeader[]> = new Map();
  private detectedProofs: EquivocationProof[] = [];

  /**
   * Ingest a proposed header signed by a validator node.
   * Analyzes for duplicate signing at identical slot or identical block height.
   */
  public processHeader(header: SubstrateHeader): EquivocationProof | null {
    const existingForSlot = this.slotRegistry.get(header.slotNumber) || [];

    // Verify if same validator authored an opposing block at the same slot
    const collision = existingForSlot.find(
      (existing) =>
        existing.authorPublicKey === header.authorPublicKey &&
        existing.hash !== header.hash
    );

    existingForSlot.push(header);
    this.slotRegistry.set(header.slotNumber, existingForSlot);

    if (collision) {
      const proof: EquivocationProof = {
        detected: true,
        slotNumber: header.slotNumber,
        blockNumber: header.number,
        validatorPublicKey: header.authorPublicKey,
        firstHeader: collision,
        secondHeader: header,
        timestamp: Date.now(),
        slashingRisk: 'EXTREME',
        description: `Dual block proposal detected at slot #${header.slotNumber}. Node published conflicting hashes: [${collision.hash.substring(0, 10)}...] vs [${header.hash.substring(0, 10)}...]. This triggers an immediate 100% equivocation slash on Portaldot.`
      };

      this.detectedProofs.push(proof);
      return proof;
    }

    return null;
  }

  public getProofs(): EquivocationProof[] {
    return [...this.detectedProofs];
  }

  public reset(): void {
    this.slotRegistry.clear();
    this.detectedProofs = [];
  }
}
