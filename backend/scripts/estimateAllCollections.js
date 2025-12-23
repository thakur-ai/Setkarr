function bytes(n){
  if (n < 1024) return `${n} B`;
  if (n < 1024*1024) return `${(n/1024).toFixed(2)} KB`;
  return `${(n/1024/1024).toFixed(2)} MB`;
}

function sizeOf(obj){
  return Buffer.byteLength(JSON.stringify(obj), 'utf8');
}

function sampleUser(type){
  const base = {
    _id: '60f5b2f9c1a4b69d2b8a1e9f',
    name: 'John Doe',
    email: 'john.doe@example.com',
    password: '$2a$10$hashedpassword',
    phone: '+1234567890',
    role: type === 'barber' ? 'barber' : 'customer',
    profilePicture: 'https://cdn.example.com/avatar.jpg',
    expoPushToken: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
    trustedContacts: [{ name: 'Jane', phone: '+1111111111' }],
  };
  if (type === 'barber'){
    base.twoFactorEnabled = true;
    base.setkarCoins = 100;
  }
  return base;
}

function sampleShop(){
  return {
    _id: '60f5b2f9c1a4b69d2b8a1e9e',
    owner: '60f5b2f9c1a4b69d2b8a1e9f',
    name: 'Karr Barber Shop',
    address: '123 Main St, City',
    phone: '+1234567890',
    image: 'https://cdn.example.com/shop.jpg',
    rating: 4.5,
    services: [ { id: '1', name: 'Haircut', price: '250', time: '30' } ],
    location: { type: 'Point', coordinates: [77.5946, 12.9716] },
  };
}

function sampleReview(){
  return {
    bookingId: '60f5b2f9c1a4b69d2b8a1e9a',
    barberId: '60f5b2f9c1a4b69d2b8a1e9e',
    userId: '60f5b2f9c1a4b69d2b8a1e9f',
    rating: 5,
    comment: 'Great service',
    createdAt: new Date().toISOString(),
  };
}

function sampleNotification(){
  return {
    userId: '60f5b2f9c1a4b69d2b8a1e9f',
    title: 'Booking Confirmed',
    message: 'Your booking is confirmed for 10:30 on 2025-12-12',
    date: new Date().toISOString(),
    read: false,
  };
}

function sampleChat(){
  return {
    sender: '60f5b2f9c1a4b69d2b8a1e9f',
    receiver: '60f5b2f9c1a4b69d2b8a1e9e',
    message: 'Hi, is the 10:30 slot available?',
    timestamp: new Date().toISOString(),
    appType: 'customer-app'
  };
}

function sampleAd(){
  return {
    barberId: '60f5b2f9c1a4b69d2b8a1e9e',
    mediaUrl: 'https://cdn.example.com/ad.jpg',
    mediaType: 'image',
    startDate: new Date().toISOString(),
    endDate: new Date(Date.now() + 10*24*3600*1000).toISOString(),
    price: 999,
    status: 'active'
  };
}

function sampleListing(){
  return { tierId: 1, category: 'Barber', lockedBy: '60f5b2f9c1a4b69d2b8a1e9f', lockedAt: new Date().toISOString() };
}

function sampleBooking(){
  return {
    _id: '60f5b2f9c1a4b69d2b8a1e9b',
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
    createdAt: new Date().toISOString(),
  };
}

const collections = [
  { name: 'users', sample: sampleUser('customer'), idxCount: 2 },
  { name: 'barbers', sample: sampleUser('barber'), idxCount: 2 }, // barbers are users but show separately
  { name: 'shops', sample: sampleShop(), idxCount: 1 },
  { name: 'bookings', sample: sampleBooking(), idxCount: 1 },
  { name: 'reviews', sample: sampleReview(), idxCount: 1 },
  { name: 'notifications', sample: sampleNotification(), idxCount: 1 },
  { name: 'chats', sample: sampleChat(), idxCount: 1 },
  { name: 'adplacements', sample: sampleAd(), idxCount: 1 },
  { name: 'listingplaces', sample: sampleListing(), idxCount: 1 },
];

// target counts (user asked): 1000 users, 100 barbers, 100000 bookings
const counts = {
  users: 1000,
  barbers: 100,
  shops: 100,
  bookings: 100000,
  reviews: 50000,
  notifications: 200000,
  chats: 200000,
  adplacements: 200,
  listingplaces: 50,
};

console.log('Per-collection size estimates:\n');

let grandTotalBytes = 0;

collections.forEach(col => {
  const s = sizeOf(col.sample);
  const indexOverheadPerDoc = 120 * col.idxCount; // bytes
  const perDocTotal = s + indexOverheadPerDoc;
  const count = counts[col.name] || 0;
  const totalBytes = perDocTotal * count;
  grandTotalBytes += totalBytes;
  console.log(`- ${col.name}:`);
  console.log(`  sample JSON size: ${bytes(s)} (${s} bytes)`);
  console.log(`  index entries: ${col.idxCount} => +${bytes(indexOverheadPerDoc)} per doc`);
  console.log(`  per-doc (with indexes): ${bytes(perDocTotal)} (${perDocTotal} bytes)`);
  console.log(`  count: ${count.toLocaleString()} => total ${bytes(totalBytes)} (${totalBytes} bytes)\n`);
});

console.log('Grand total across collections: ' + bytes(grandTotalBytes) + ` (${grandTotalBytes} bytes)`);
console.log('\nNotes:');
console.log('- Estimates are JSON byte lengths plus conservative index overhead estimates.');
console.log('- Real MongoDB on-disk size varies with compression, padding, index storage, and attachments.');
console.log('- I treated barbers as separate entries (100) for clarity, but in this schema barbers are `users` with role `barber`.');
