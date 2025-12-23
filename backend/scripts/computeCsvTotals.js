const fs = require('fs');
const path = require('path');
const csvPath = path.join(__dirname, '..', 'reports', 'storage_estimate_from_screenshot.csv');
if (!fs.existsSync(csvPath)) {
  console.error('CSV not found:', csvPath);
  process.exit(1);
}
const data = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
const header = data[0].split(',');
const headerStr = data[0];
const rows = data.slice(1).map(line => {
  const [Collection, AvgDocBytes, IndexPerDocBytes, PerDocWithIndexBytes, Count, TotalBytes, TotalMB] = line.split(',');
  return {
    Collection,
    AvgDocBytes: Number(AvgDocBytes),
    IndexPerDocBytes: Number(IndexPerDocBytes),
    PerDocWithIndexBytes: Number(PerDocWithIndexBytes),
    Count: Number(Count.replace(/,/g, '')),
    TotalBytes: BigInt(TotalBytes.replace(/,/g, '')),
    TotalMB: Number(TotalMB),
  };
});

let grandTotalBytes = rows.reduce((acc, r) => acc + r.TotalBytes, 0n);
let grandTotalMB = Number(grandTotalBytes) / (1024 * 1024);
let grandTotalGB = grandTotalMB / 1024;

console.log('| Collection | Per-doc (avg) | Index per-doc | Per-doc (with index) | Count | Total (MB) | Total (bytes) |');
console.log('|---|---:|---:|---:|---:|---:|---:|');
rows.forEach(r => {
  console.log(`| ${r.Collection} | ${r.AvgDocBytes} B | ${r.IndexPerDocBytes} B | ${r.PerDocWithIndexBytes} B | ${r.Count.toLocaleString()} | ${r.TotalMB.toFixed(2)} MB | ${r.TotalBytes.toString()} |`);
});
console.log(`\nGrand total: ${grandTotalMB.toFixed(2)} MB (${grandTotalBytes.toString()} bytes) — ${grandTotalGB.toFixed(2)} GB`);

// write extended CSV with TotalGB and Grand Total row
const extHeader = headerStr + ',TotalGB\n';
const extLines = rows.map(r => `${r.Collection},${r.AvgDocBytes},${r.IndexPerDocBytes},${r.PerDocWithIndexBytes},${r.Count},${r.TotalBytes.toString()},${r.TotalMB.toFixed(2)},${(r.TotalMB/1024).toFixed(4)}`).join('\n');
const extCsv = extHeader + extLines + '\nGrand Total,,,,,' + grandTotalBytes.toString() + ',' + grandTotalMB.toFixed(2) + ',' + grandTotalGB.toFixed(2) + '\n';
const outPath2 = path.join(path.dirname(csvPath), 'storage_estimate_from_screenshot_with_grand_total.csv');
fs.writeFileSync(outPath2, extCsv);
console.log('Wrote extended CSV to', outPath2);
