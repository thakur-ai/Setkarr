function bytes(n){
  if (n < 1024) return `${n} B`;
  if (n < 1024*1024) return `${(n/1024).toFixed(2)} KB`;
  return `${(n/1024/1024).toFixed(2)} MB`;
}

function sizeOf(obj){
  const s = Buffer.byteLength(JSON.stringify(obj), 'utf8');
  return s;
}

function sampleBooking(type){
  const base = {
    _id: '60f5b2f9c1a4b69d2b8a1e9f',
    userId: '60f5b2f9c1a4b69d2b8a1e9f',
    barberId: '60f5b2f9c1a4b69d2b8a1e9e',
    isOfflineBooking: false,
    services: [ { id: '1', name: 'Haircut', price: 250 } ],
    date: new Date().toISOString(),
    time: '10:30',
    status: 'confirmed',
    paymentStatus: 'completed',
    totalPrice: 250,
    appointmentType: 'in-shop',
    otp: '1234',
    createdAt: new Date().toISOString(),
  };

  if (type === 'min') return base;

  if (type === 'typical'){
    base.customerName = 'John Doe';
    base.customerPhone = '+1234567890';
    base.services.push({ id: '2', name: 'Beard Trim', price: 100 });
    base.cancellationReason = null;
    base.paymentIntentId = 'pi_1Fxxxxxx';
    return base;
  }

  if (type === 'max'){
    base.customerName = 'A very long customer name that might be used in some edge cases';
    base.customerPhone = '+123456789012345';
    base.services = [];
    for(let i=0;i<8;i++) base.services.push({ id: String(i), name: `Service ${i} with description`, price: 200 + i });
    base.cancellationReason = 'Some long reason with extra details about merchant, timing, and customer';
    base.paymentIntentId = 'pi_1FxxxxxxVeryLongIdExampleWithExtraChars';
    base.notes = 'Customer requested a special shampoo and long aftercare instructions that are text heavy.';
    return base;
  }
}

['min','typical','max'].forEach(type=>{
  const doc = sampleBooking(type);
  const s = sizeOf(doc);
  const indexEstimate = 120; // rough bytes per indexed entry (barberId+date+time + btree overhead)
  const totalWithIndex = s + indexEstimate;
  console.log(`\n${type.toUpperCase()} booking estimate:`);
  console.log(`- JSON serialized size: ${bytes(s)} (${s} bytes)`);
  console.log(`- +single index entry estimate: ${bytes(totalWithIndex)} (${totalWithIndex} bytes)`);

  [1e3,1e4,1e5,1e6].forEach(count => {
    const totalMB = (totalWithIndex * count) / (1024*1024);
    console.log(`  -> ${count.toLocaleString()} bookings ≈ ${totalMB.toFixed(2)} MB`);
  });
});

console.log('\nNotes:');
console.log('- This measures JSON byte length (approximate BSON size).');
console.log('- Real MongoDB on-disk size depends on WiredTiger compression, padding, and actual index storage.');
console.log('- Attachments (images/audio) significantly increase size and are typically stored in GridFS or external storage.');
