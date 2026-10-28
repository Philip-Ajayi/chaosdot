import { EquivocationDetector } from '../src/consensus/equivocation-detector';
import { SubstrateHeader } from '../src/types';

function runEquivocationTest() {
  console.log('🧪 [TEST] Running Equivocation Detection Unit Test...');
  const detector = new EquivocationDetector();

  const authorKey = '0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d';

  const block1: SubstrateHeader = {
    number: 100,
    hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
    parentHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    stateRoot: '0x00',
    extrinsicsRoot: '0x00',
    slotNumber: 500,
    authorPublicKey: authorKey,
    signature: '0xsig1',
    timestamp: Date.now()
  };

  const block2Collision: SubstrateHeader = {
    number: 100,
    hash: '0x2222222222222222222222222222222222222222222222222222222222222222',
    parentHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    stateRoot: '0x00',
    extrinsicsRoot: '0x00',
    slotNumber: 500, // Identical slot!
    authorPublicKey: authorKey, // Same author!
    signature: '0xsig2',
    timestamp: Date.now()
  };

  const res1 = detector.processHeader(block1);
  if (res1 !== null) {
    throw new Error('Test Failed: First block should not trigger equivocation');
  }

  const proof = detector.processHeader(block2Collision);
  if (!proof || !proof.detected) {
    throw new Error('Test Failed: Equivocation detector failed to catch identical slot collision!');
  }

  console.log('✅ [PASSED] Equivocation detector correctly caught dual block proposals:');
  console.log(`   Slot: ${proof.slotNumber}`);
  console.log(`   Hash A: ${proof.firstHeader.hash.substring(0, 14)}...`);
  console.log(`   Hash B: ${proof.secondHeader.hash.substring(0, 14)}...`);
}

runEquivocationTest();
