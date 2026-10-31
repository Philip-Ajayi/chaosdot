import { SubstrateHeader, EquivocationProof } from '../types';

export class EquivocationDetector {
  private slotRegistry: Map<number, SubstrateHeader[]> = new Map();
  private detectedProofs: EquivocationProof[] = [];

  public processHeader(header: SubstrateHeader): EquivocationProof | null {
    if (header.slotNumber <= 0) {
      return null;
    }

    const existingForSlot = this.slotRegistry.get(header.slotNumber) || [];

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
        description: `Dual block proposal detected at slot #${header.slotNumber}. Conflicting block hashes published: [${collision.hash}] vs [${header.hash}]. Slashed under NPoS consensus.`
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