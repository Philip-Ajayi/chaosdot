#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import YAML from 'yaml';
import { VirtualPortaldotCluster } from '../consensus/virtual-portaldot-cluster';
import { EquivocationDetector } from '../consensus/equivocation-detector';
import { ScenarioRegistry } from '../scenarios/scenario-registry';
import { AuditGenerator } from '../reporting/audit-generator';
import { ValidatorClusterConfig } from '../types';

const program = new Command();

program
  .name('chaosdot')
  .description('Live Slashing Resilience Verifier & Consensus Fault Injector for Substrate & Portaldot')
  .version('2.0.0');

program
  .command('test')
  .description('Execute live slashing audit suite against specified node endpoints')
  .option('-c, --config <path>', 'Path to YAML configuration', './validator-setup.yml')
  .option('-p, --primary-rpc <url>', 'Primary node WebSocket RPC URL')
  .option('-b, --backup-rpc <url>', 'Backup node WebSocket RPC URL')
  .option('-t, --toxiproxy <url>', 'Toxiproxy REST API URL')
  .option('-k, --validator-key <key>', 'Target validator public key')
  .option('-s, --simulation', 'Run in standalone simulation mode without live blockchain nodes', false)
  .option('-o, --output <path>', 'Destination for HTML certification report', './chaosdot-audit.html')
  .action(async (options) => {
    console.log(chalk.bold.magenta('\n==============================================================='));
    console.log(chalk.bold.magenta('  🛡️  ChaosDot: Live Slashing Resilience Verifier'));
    console.log(chalk.bold.magenta('===============================================================\n'));

    let config: ValidatorClusterConfig = {
      network: 'portaldot-live',
      consensus: 'AURA-BABE',
      slotDurationMs: 6000,
      simulationMode: Boolean(options.simulation),
      toxiproxyUrl: options.toxiproxy || 'http://127.0.0.1:8474',
      primaryNode: {
        id: 'portaldot-val-01',
        rpcEndpoint: options.primaryRpc || 'ws://127.0.0.1:9944',
        proxyName: 'primary-portaldot',
        authoringKey: options.validatorKey || '0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d'
      },
      backupNode: {
        id: 'portaldot-val-02',
        rpcEndpoint: options.backupRpc || 'ws://127.0.0.1:9945',
        proxyName: 'backup-portaldot',
        authoringKey: options.validatorKey || '0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d'
      },
      pacemaker: {
        heartbeatTimeoutMs: 6000,
        failoverLock: 'raft',
        fencingTokenEnabled: true
      }
    };

    if (fs.existsSync(options.config)) {
      console.log(chalk.cyan(`[INFO] Reading config from: ${options.config}`));
      const parsed = YAML.parse(fs.readFileSync(options.config, 'utf8'));
      if (parsed.nodes?.primary?.rpc_endpoint) config.primaryNode.rpcEndpoint = parsed.nodes.primary.rpc_endpoint;
      if (parsed.nodes?.primary?.proxy_name) config.primaryNode.proxyName = parsed.nodes.primary.proxy_name;
      if (parsed.nodes?.backup?.rpc_endpoint) config.backupNode.rpcEndpoint = parsed.nodes.backup.rpc_endpoint;
      if (parsed.nodes?.backup?.proxy_name) config.backupNode.proxyName = parsed.nodes.backup.proxy_name;
      if (parsed.toxiproxy?.url) config.toxiproxyUrl = parsed.toxiproxy.url;
    }

    const cluster = new VirtualPortaldotCluster(config);
    const detector = new EquivocationDetector();

    try {
      await cluster.start(
        (header) => {
          const proof = detector.processHeader(header);
          if (proof) {
            console.log(chalk.bgRed.white.bold(` [EQUIVOCATION DETECTED] Slot #${proof.slotNumber} `));
          }
        },
        (log) => console.log(chalk.gray(log))
      );
    } catch (err: any) {
      console.error(chalk.red(`\n[FATAL] Unable to connect to cluster nodes: ${err.message}`));
      process.exit(1);
    }

    console.log(chalk.yellow('\n[RUNNING] Executing consensus scenarios against target endpoints...\n'));

    const report = await ScenarioRegistry.runAll(cluster, detector, (msg) => {
      console.log(chalk.white(msg));
    });

    cluster.stop();

    console.log('\n---------------------------------------------------------------');
    console.log(chalk.bold('LIVE AUDIT SUMMARY:'));
    console.log(`Hardening Score: ${report.overallHardeningScore >= 90 ? chalk.green.bold(report.overallHardeningScore) : chalk.red.bold(report.overallHardeningScore)} / 100`);
    console.log(`Verdict: ${report.verdict === 'CERTIFIED_IMMUNE' ? chalk.bgGreen.black.bold(` ${report.verdict} `) : chalk.bgRed.white.bold(` ${report.verdict} `)}`);
    console.log('---------------------------------------------------------------\n');

    const htmlReport = AuditGenerator.generateHtml(report);
    fs.writeFileSync(options.output, htmlReport);
    console.log(chalk.green(`[SUCCESS] Certified report exported to: ${options.output}\n`));
    process.exit(report.verdict === 'CERTIFIED_IMMUNE' ? 0 : 1);
  });

program.parse(process.argv);