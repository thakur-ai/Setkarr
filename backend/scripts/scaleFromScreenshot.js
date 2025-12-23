// Uses the screenshot values provided by the user to estimate storage for provided counts.
// Run: node scaleFromScreenshot.js

const KB = 1024;
const MB = 1024 * KB;

const sampleStats = [
  { name: 'adplacements', avgDocBytes: 220, docs: 1, totalIndexSizeKB: 73.73 },
  { name: 'bookings', avgDocBytes: 385, docs: 479, totalIndexSizeKB: 98.30 },
  { name: 'chatmessages', avgDocBytes: 158, docs: 14, totalIndexSizeKB: 36.86 },
  { name: 'clickevents', avgDocBytes: 100, docs: 9, totalIndexSizeKB: 20.48 },
  { name: 'listingplaces', avgDocBytes: 95, docs: 6, totalIndexSizeKB: 73.73 },
  { name: 'notifications', avgDocBytes: 198, docs: 233, totalIndexSizeKB: 36.86 },
  { name: 'reviews', avgDocBytes: 168, docs: 17, totalIndexSizeKB: 36.86 },
  { name: 'shops', avgDocBytes: 710, docs: 4, totalIndexSizeKB: 36.86 },
  { name: 'users', avgDocBytes: 376, docs: 13, totalIndexSizeKB: 73.73 },
];

// target counts from user
const targets = {
  users: 20000,
  barbers: 2000,
  shops: 2000,
  bookings: 2000000,
  // reviews count will be computed from `reviewsTotalMBOverride` below; set to 0 initially
  reviews: 0,
  notifications: 50000,
  chats: 50000,
  adplacements: 4000,
  listingplaces: 1000,
};

// Override: set reviews total to this MB value (user asked for 1000 MB)
const reviewsTotalMBOverride = 1000; // set to null to disable override

// If override is set, compute the necessary reviews count from sample stats
if (reviewsTotalMBOverride) {
  const reviewSample = sampleStats.find(s => s.name === 'reviews');
  if (reviewSample) {
    const totalIndexBytesSample = Math.round(reviewSample.totalIndexSizeKB * KB);
    const indexPerDocSample = reviewSample.docs > 0 ? totalIndexBytesSample / reviewSample.docs : 0;
    const perDocTotalBytes = Math.round(reviewSample.avgDocBytes + indexPerDocSample);
    const desiredBytes = reviewsTotalMBOverride * MB;
    const computedCount = Math.ceil(desiredBytes / perDocTotalBytes);
    targets.reviews = computedCount;
  }
}

// Map sample collection names to target names where they differ
const mapName = (n) => {
  if (n === 'chatmessages') return 'chats';
  return n;
};

function bytesToKB(b){ return b / KB; }
function bytesToMB(b){ return b / MB; }

const rows = [];

let grandTotalBytes = 0n; // BigInt for large totals

sampleStats.forEach(sample => {
  const targetName = mapName(sample.name);
  const targetCount = targets[targetName] ?? (targetName === 'barbers' ? targets['barbers'] : 0);
  if (typeof targetCount === 'undefined' || targetCount === 0) return; // no need

  // Compute index per document from sample data
  const totalIndexBytesSample = BigInt(Math.round(sample.totalIndexSizeKB * KB));
  const indexPerDocSample = sample.docs > 0 ? Number(totalIndexBytesSample) / sample.docs : 0; // bytes per doc (number)

  // per-doc total = avgDocBytes + indexPerDoc
  const perDocTotalBytesNumber = Math.round(sample.avgDocBytes + indexPerDocSample);
  const totalBytes = BigInt(perDocTotalBytesNumber) * BigInt(targetCount);

  rows.push({
    collection: targetName,
    sampleAvgDocBytes: sample.avgDocBytes,
    sampleDocs: sample.docs,
    sampleTotalIndexKB: sample.totalIndexSizeKB,
    indexPerDocBytes: Math.round(indexPerDocSample),
    perDocTotalBytes: perDocTotalBytesNumber,
    targetCount,
    totalBytes: totalBytes,
    totalMB: Number(totalBytes) / MB,
  });

  grandTotalBytes += totalBytes;
});

// Some target collections were not present in sampleStats (e.g., "barbers") — for those, use users sample as proxy
if (!rows.some(r => r.collection === 'barbers')){
  const userSample = sampleStats.find(s => s.name === 'users');
  const targetCount = targets.barbers;
  const totalIndexBytesSample = Math.round(userSample.totalIndexSizeKB * KB);
  const indexPerDocSample = userSample.docs > 0 ? totalIndexBytesSample / userSample.docs : 0;
  const perDocTotalBytes = userSample.avgDocBytes + indexPerDocSample;
  const totalBytesBig = BigInt(Math.round(perDocTotalBytes)) * BigInt(targetCount);
  rows.push({
    collection: 'barbers',
    sampleAvgDocBytes: userSample.avgDocBytes,
    sampleDocs: userSample.docs,
    sampleTotalIndexKB: userSample.totalIndexSizeKB,
    indexPerDocBytes: Math.round(indexPerDocSample),
    perDocTotalBytes: Math.round(perDocTotalBytes),
    targetCount,
    totalBytes: totalBytesBig,
    totalMB: Number(totalBytesBig) / MB,
  });
  grandTotalBytes += totalBytesBig;
}

// Add any targets that don't have a sample row but were in counts (shops handled, listingplaces handled)
if (!rows.some(r => r.collection === 'shops')){
  const shopSample = sampleStats.find(s => s.name === 'shops');
  const targetCount = targets.shops;
  const totalIndexBytesSample = Math.round(shopSample.totalIndexSizeKB * KB);
  const indexPerDocSample = shopSample.docs > 0 ? totalIndexBytesSample / shopSample.docs : 0;
  const perDocTotalBytes = shopSample.avgDocBytes + indexPerDocSample;
  const totalBytesBig = BigInt(Math.round(perDocTotalBytes)) * BigInt(targetCount);
  rows.push({
    collection: 'shops',
    sampleAvgDocBytes: shopSample.avgDocBytes,
    sampleDocs: shopSample.docs,
    sampleTotalIndexKB: shopSample.totalIndexSizeKB,
    indexPerDocBytes: Math.round(indexPerDocSample),
    perDocTotalBytes: Math.round(perDocTotalBytes),
    targetCount,
    totalBytes: totalBytesBig,
    totalMB: Number(totalBytesBig) / MB,
  });
  grandTotalBytes += totalBytesBig;
}

// If there are targets like 'bookings', 'reviews', 'notifications', 'chats', 'adplacements', 'listingplaces' those will be in rows

// Calculate and sort rows in a nice order to match user preference
const desiredOrder = ['users','barbers','shops','bookings','reviews','notifications','chats','adplacements','listingplaces'];
rows.sort((a,b) => desiredOrder.indexOf(a.collection) - desiredOrder.indexOf(b.collection));

const fs = require('fs');
const path = require('path');

// Output nice table and write CSV
const header = 'Collection,AvgDocBytes,IndexPerDocBytes,PerDocWithIndexBytes,Count,TotalBytes,TotalMB\n';
const csvLines = rows.map(r => `${r.collection},${r.sampleAvgDocBytes},${r.indexPerDocBytes},${r.perDocTotalBytes},${r.targetCount},${r.totalBytes.toString()},${r.totalMB.toFixed(2)}`).join('\n');
const csvContent = header + csvLines + '\n';
const outDir = path.join(__dirname, '..', 'reports');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'storage_estimate_from_screenshot.csv');
fs.writeFileSync(outPath, csvContent);

console.log('Collection,Per doc (avg),Index per doc (bytes),Per-doc (with index),Count,Total bytes,Total MB');
console.log(csvLines);

console.log('\nHuman-friendly table:\n');
console.log('| Collection | Per-doc (avg) | Index per-doc | Per-doc (with index) | Count | Total (MB) |');
console.log('|---|---:|---:|---:|---:|---:|');
rows.forEach(r => {
  console.log(`| ${r.collection} | ${r.sampleAvgDocBytes} B | ${r.indexPerDocBytes} B | ${r.perDocTotalBytes} B | ${r.targetCount.toLocaleString()} | ${r.totalMB.toFixed(2)} MB |`);
});

console.log('\nGrand total: ' + (Number(grandTotalBytes) / MB).toFixed(2) + ' MB (' + grandTotalBytes.toString() + ' bytes)');

