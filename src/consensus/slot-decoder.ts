import { SubstrateHeader } from '../types';

export class SlotDecoder {
  /**
   * Authentic Substrate SCALE Digest Decoder.
   * Extracts slot number from AURA (0x61757261) and BABE (0x42414245) pre-runtime digests.
   */
  public static extractSlot(rawDigestLogs: string[]): number {
    if (!rawDigestLogs || !Array.isArray(rawDigestLogs)) {
      return 0;
    }

    for (const log of rawDigestLogs) {
      const cleanHex = log.startsWith('0x') ? log.slice(2) : log;
      if (cleanHex.length < 10) continue;

      // Extract consensus engine ID (4 bytes = 8 hex characters after 1 byte digest type)
      const engineTag = cleanHex.slice(2, 10).toLowerCase();

      // Aura Pre-Runtime Digest: [0x06 (type), 'aura' (4 bytes), Slot (u64 LE, 8 bytes)]
      if (engineTag === '61757261') {
        const slotHex = cleanHex.slice(10, 26);
        if (slotHex.length === 16) {
          const buf = Buffer.from(slotHex, 'hex');
          return Number(buf.readBigUInt64LE(0));
        }
      }

      // BABE Pre-Runtime Digest: [0x06 (type), 'BABE' (4 bytes), Variant (1 byte), Slot (u64 LE, 8 bytes)]
      if (engineTag === '42414245') {
        const slotHex = cleanHex.slice(12, 28);
        if (slotHex.length === 16) {
          const buf = Buffer.from(slotHex, 'hex');
          return Number(buf.readBigUInt64LE(0));
        }
      }
    }

    return 0;
  }

  public static verifyHeaderIntegrity(header: SubstrateHeader): boolean {
    return (
      header.hash.startsWith('0x') &&
      header.hash.length === 66 &&
      header.parentHash.startsWith('0x') &&
      header.parentHash.length === 66 &&
      header.number >= 0
    );
  }
}