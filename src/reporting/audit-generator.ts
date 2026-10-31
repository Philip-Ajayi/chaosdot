import { SlashingAuditReport } from '../types';

export class AuditGenerator {
  public static generateMarkdown(report: SlashingAuditReport): string {
    const lines: string[] = [];
    lines.push('# ChaosDot Slashing Resilience Audit Report');
    lines.push(`**Generated:** ${report.timestamp}`);
    lines.push(`**Score:** ${report.overallHardeningScore} / 100 [${report.verdict}]`);
    lines.push('');
    lines.push('## Target Cluster Configuration');
    lines.push(`- **Primary RPC:** \`${report.clusterConfig.primaryNode}\``);
    lines.push(`- **Backup RPC:** \`${report.clusterConfig.backupNode}\``);
    lines.push(`- **Validator Key:** \`${report.clusterConfig.targetValidatorKey}\``);
    lines.push(`- **Pacemaker Lease:** \`${report.clusterConfig.pacemakerLeaseMs} ms\``);
    lines.push(`- **Toxiproxy Engine:** \`${report.clusterConfig.toxiproxyUrl}\``);
    lines.push('');
    lines.push('## Test Execution Results');
    lines.push('| Scenario | Equivocation | Deduction | Verdict |');
    lines.push('| :--- | :---: | :---: | :--- |');

    for (const r of report.scenarioResults) {
      lines.push(
        `| ${r.name} | ${r.equivocationDetected ? '🚨 DETECTED' : '🛡️ CLEAN'} | -${r.scoreDeduction} | ${r.passed ? '✅ PASS' : '❌ FAIL'} |`
      );
    }

    lines.push('');
    lines.push('## Remediation Guidance');
    for (const [idx, plan] of report.remediationPlan.entries()) {
      lines.push(`${idx + 1}. ${plan}`);
    }

    return lines.join('\n');
  }

  public static generateHtml(report: SlashingAuditReport): string {
    const isImmune = report.verdict === 'CERTIFIED_IMMUNE';
    const color = isImmune ? '#10b981' : report.verdict === 'WARNING' ? '#f59e0b' : '#ef4444';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>ChaosDot Slashing Audit Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; background: #090d16; color: #f8fafc; padding: 40px; }
    .card { background: #131b2e; border-radius: 12px; border: 1px solid #1e293b; padding: 32px; max-width: 900px; margin: 0 auto; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
    .badge { display: inline-block; padding: 6px 14px; border-radius: 9999px; font-weight: 700; font-size: 13px; background: ${color}; color: #000; }
    h1 { margin-top: 0; font-size: 26px; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { text-align: left; padding: 12px; border-bottom: 1px solid #1e293b; font-size: 13px; }
    th { color: #94a3b8; }
    .box { background: #0b1120; border-radius: 8px; padding: 16px; margin-top: 20px; border-left: 4px solid ${color}; }
  </style>
</head>
<body>
  <div class="card">
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <h1>🛡️ ChaosDot Security Audit Certificate</h1>
      <span class="badge">${report.verdict}</span>
    </div>
    <p style="color:#94a3b8;">Portaldot / Substrate Validator Slashing Immunity Verification</p>
    <hr style="border:none; border-top: 1px solid #1e293b; margin: 20px 0;" />

    <h3>Score: <span style="color:${color}">${report.overallHardeningScore} / 100</span></h3>
    <p>Target Validator Key: <code>${report.clusterConfig.targetValidatorKey}</code></p>
    <p>Primary Node: <code>${report.clusterConfig.primaryNode}</code></p>
    <p>Backup Node: <code>${report.clusterConfig.backupNode}</code></p>

    <table>
      <thead>
        <tr><th>Scenario</th><th>Equivocation Triggered</th><th>Score Deduction</th><th>Status</th></tr>
      </thead>
      <tbody>
        ${report.scenarioResults
          .map(
            (r) => `<tr>
          <td><strong>${r.name}</strong></td>
          <td>${r.equivocationDetected ? '<span style="color:#ef4444">YES (Double-Sign)</span>' : '<span style="color:#10b981">NONE</span>'}</td>
          <td>-${r.scoreDeduction}</td>
          <td>${r.passed ? '<span style="color:#10b981">PASS</span>' : '<span style="color:#ef4444">FAIL</span>'}</td>
        </tr>`
          )
          .join('')}
      </tbody>
    </table>

    <div class="box">
      <h4 style="margin-top:0;">Remediation Recommendations:</h4>
      <ul>
        ${report.remediationPlan.map((p) => `<li>${p}</li>`).join('')}
      </ul>
    </div>
    <p style="font-size: 11px; color: #64748b; margin-top: 30px;">Executed via ChaosDot &bull; Timestamp: ${report.timestamp}</p>
  </div>
</body>
</html>`;
  }
}