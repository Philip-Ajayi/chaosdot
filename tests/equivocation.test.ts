import { EquivocationDetector } from '../src/consensus/equivocation-detector';
import { SlotDecoder } from '../src/consensus/slot-decoder';
import { SubstrateHeader } from '../src/types';

function runEquivocationTest() {
  console.log('🧪 [TEST] Validating live SCALE slot decoder and equivocation logic...');

  // Authentic Aura pre-runtime log (slot 1500)
  // 0x06 (pre-runtime), 61757261 ('aura'), dc05000000000000 (u64 LE = 1500)
  const auraDigest = '0x0661757261dc05000000000000';
  const extractedSlot = SlotDecoder.extractSlot([auraDigest]);

  if (extractedSlot !== 1500) {
    throw new Error(`Aura SCALE extraction failed. Expected 1500, received: ${extractedSlot}`);
  }

  const detector = new EquivocationDetector();
  const authorKey = '0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d';

  const headerA: SubstrateHeader = {
    number: 200,
    hash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    parentHash: '0x9999999999999999999999999999999999999999999999999999999999999999',
    stateRoot: '0x00',
    extrinsicsRoot: '0x00',
    slotNumber: 1500,
    authorPublicKey: authorKey,
    digestLogs: [auraDigest],
    timestamp: Date.now()
  };

  const headerB: SubstrateHeader = {
    number: 200,
    hash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    parentHash: '0x9999999999999999999999999999999999999999999999999999999999999999',
    stateRoot: '0x00',
    extrinsicsRoot: '0x00',
    slotNumber: 1500,
    authorPublicKey: authorKey,
    digestLogs: [auraDigest],
    timestamp: Date.now()
  };

  const res1 = detector.processHeader(headerA);
  if (res1 !== null) throw new Error('Initial proposal should not register equivocation');

  const proof = detector.processHeader(headerB);
  if (!proof || !proof.detected) {
    throw new Error('Equivocation detector failed on duplicate slot proposal collision');
  }

  console.log('✅ [PASSED] Slot decoder and equivocation detector verified.');
}

runEquivocationTest();