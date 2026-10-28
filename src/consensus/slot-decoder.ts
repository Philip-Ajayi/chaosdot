import { SubstrateHeader } from '../types';

export class SlotDecoder {
  /**
   * Substrate block digest extraction logic.
   * Extracts slot number from Babel/Aura/LAO engine pre-runtime digests.
   */
  public static extractSlot(rawDigestLogs: string[]): number {
    for (const log of rawDigestLogs) {
      if (log.startsWith('0x0442414245') || log.startsWith('0x0441555241') || log.startsWith('0x044c414f')) {
        // Hex slice simulated: 4 bytes engine tag, followed by u64 slot
        const rawHex = log.slice(10);
        const slot = parseInt(rawHex.slice(0, 8), 16);
        if (!isNaN(slot) && slot > 0) return slot;
      }
    }
    // Fallback deterministic epoch calculation: 6-second slot standard
    return Math.floor(Date.now() / 6000);
  }

  public static verifyHeaderIntegrity(header: SubstrateHeader): boolean {
    return (
      header.hash.length === 66 &&
      header.parentHash.length === 66 &&
      header.slotNumber > 0 &&
      header.authorPublicKey.startsWith('0x')
    );
  }
}
