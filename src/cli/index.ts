#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import { VirtualPortaldotCluster } from '../consensus/virtual-portaldot-cluster';
import { EquivocationDetector } from '../consensus/equivocation-detector';
import { ScenarioRegistry } from '../scenarios/scenario-registry';
import { AuditGenerator } from '../reporting/audit-generator';

const program = new Command();

program
  .name('chaosdot')
  .description('Autonomous Slashing Resilience Fuzzer for Portaldot Validator Configurations')
  .version('1.0.0');

program
  .command('test')
  .description('Run full autonomous slashing chaos suite against Portaldot cluster')
  .option('-c, --config <path>', 'Path to validator configuration YAML', './validator-setup.yml')
  .option('-o, --output <path>', 'Destination for HTML certification report', './chaosdot-audit.html')
  .action(async (options) => {
    console.log(chalk.bold.magenta('\n==============================================================='));
    console.log(chalk.bold.magenta('  🛡️  ChaosDot: Autonomous Slashing Resilience Fuzzer'));
    console.log(chalk.bold.magenta('  Portaldot Hacker House 2026'));
    console.log(chalk.bold.magenta('===============================================================\n'));

    console.log(chalk.cyan(`[INFO] Loading configuration from: ${options.config}`));

    const cluster = new VirtualPortaldotCluster();
    const detector = new EquivocationDetector();

    cluster.start(
      (header) => {
        const proof = detector.processHeader(header);
        if (proof) {
          console.log(chalk.bgRed.white.bold(` [EQUIVOCATION DETECTED] Slot #${proof.slotNumber} `));
        }
      },
      (log) => console.log(chalk.gray(log))
    );

    console.log(chalk.yellow('[RUNNING] Executing consensus fault scenarios...\n'));

    const report = await ScenarioRegistry.runAll(cluster, detector, (msg) => {
      console.log(chalk.white(msg));
    });

    cluster.stop();

    console.log('\n---------------------------------------------------------------');
    console.log(chalk.bold('AUDIT EXECUTION SUMMARY:'));
    console.log(`Hardening Score: ${report.overallHardeningScore >= 90 ? chalk.green.bold(report.overallHardeningScore) : chalk.red.bold(report.overallHardeningScore)} / 100`);
    console.log(`Verdict: ${report.verdict === 'CERTIFIED_IMMUNE' ? chalk.bgGreen.black.bold(` ${report.verdict} `) : chalk.bgRed.white.bold(` ${report.verdict} `)}`);
    console.log('---------------------------------------------------------------\n');

    const htmlReport = AuditGenerator.generateHtml(report);
    fs.writeFileSync(options.output, htmlReport);
    console.log(chalk.green(`[SUCCESS] Slashing Audit Certificate exported to: ${options.output}\n`));
    process.exit(report.verdict === 'CERTIFIED_IMMUNE' ? 0 : 1);
  });

program.parse(process.argv);
