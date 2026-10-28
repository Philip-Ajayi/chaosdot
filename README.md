# ChaosDot 🛡️

> Consensus-Aware Chaos Engineering & Autonomous Slashing Verifier for Portaldot Validators.

## Live Testing for Judges & Operators

You can run and inspect ChaosDot immediately without downloading heavy Substrate binaries or compiling Rust. The system includes both **Substrate JSON-RPC WebSocket support** and a **Built-in Portaldot Consensus Cluster** that lets you simulate network stalls, trigger split-brain double-signing, inspect slot timelines, and download certified audit reports directly from your browser.

---

### 1. Instant 60-Second Setup

```bash
git clone https://github.com/portaldot-house/chaosdot.git
cd chaosdot

# Install dependencies
npm install

# Build TypeScript & copy public assets
npm run build

# Start the ChaosDot Server & Live Dashboard
npm start
```

Now open your browser at:
👉 **`http://localhost:3000`**

---

### 2. Live Interactive Dashboard Controls

Once `http://localhost:3000` is open:
1. **Interactive Latency Slider**: Slide the latency up to `3000 ms` to see real-time network jitter injected into block proposal heartbeats.
2. **"Trigger Split-Brain Keystore" Button**: Forces a secondary node spin-up while the primary node authoring lock is active. Watch the real-time **CRITICAL EQUIVOCATION ALARM** flash across the screen with the exact opposing Substrate block hashes.
3. **"Run Complete Autonomous Audit"**: Executes all 3 consensus scenarios in sequence, computes the **Slashing Hardening Score (0–100)**, and enables instant **HTML & Markdown Certificate Exports**.

---

### 3. Running from CLI

You can also run ChaosDot in CI/CD pipelines to block misconfigured validator deployments before they hit production:

```bash
# Run the autonomous audit via CLI
npm run cli -- test --config ./validator-setup.yml --output ./chaosdot-audit.html
```

---

### 4. Docker One-Command Deployment

```bash
docker compose up --build
```
Open `http://localhost:3000` to interact with the full stack.

---

### 5. Automated Unit Test Verification

To mathematically test the equivocation detector:
```bash
npm test
```
```

---

## Live Verification & Demonstration Walkthrough

When you start the server and run the test suite, you will observe the following deterministic consensus audit flow:

```
[INIT] Virtual Portaldot Cluster started. Primary & Backup nodes online.
[PRIMARY:01] Proposed Block #10451 for Slot 284102 [Hash: 0x8a92f0c184...]
[CHAOS] Injected network latency: 3000ms
SCENARIO 2: Split-Brain Keystore (Dual Concurrent Authors)
[Step 2] Inducing distributed lock lease race (Split-Brain trigger)...
[PRIMARY:01] Proposed Block #10452 for Slot 284103 [Hash: 0xa4b192c019...]
[BACKUP:02] Proactive Failover: Proposed Block #10452 for Slot 284103 [Hash: 0xf55291b891...]
🚨 [EQUIVOCATION EVENT DETECTED]: Slashed validator 0xd43593c715... at Slot #284103
Dual block proposal detected at slot #284103: [0xa4b192c019...] vs [0xf55291b891...]
[SUCCESS] Slashing Audit Certificate exported to: ./chaosdot-audit.html
Hardening Score: 50 / 100 [CRITICAL_RISK]
