const { auditLogs } = require('../src/storage');
const { verifyAuditLogChain } = require('../src/auditLogs');

const report = verifyAuditLogChain(auditLogs);
console.log(JSON.stringify(report, null, 2));

if (!report.valid) {
  process.exitCode = 1;
}