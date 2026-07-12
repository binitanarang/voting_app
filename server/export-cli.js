/* Standalone export: DATA_DIR=data/<competition> node server/export-cli.js [reason]
   Used by seed.js (in a child process, so it can archive a database this
   process is about to delete) and handy for manual backups. */
const { exportSnapshot } = await import('./export.js');
const result = exportSnapshot(process.argv[2] ?? 'manual');
console.log(JSON.stringify(result));
