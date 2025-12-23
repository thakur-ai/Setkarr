const mongoose = require('mongoose');
const ExclusiveDeal = require('./models/ExclusiveDeal');
require('dotenv').config({ path: './.env' });

const sampleDeals = [
  {
    title: "Welcome Bonus",
    description: "Get 50 bonus coins on your first recharge of ₹500 or more!",
    discountPercentage: 0,
    bonusCoins: 50,
    minimumPurchase: 500,
    validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
    isActive: true,
  },
  {
    title: "Festive Special",
    description: "Enjoy 20% discount on all grooming services this festive season",
    discountPercentage: 20,
    bonusCoins: 0,
    minimumPurchase: 1000,
    validUntil: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days from now
    isActive: true,
  },
  {
    title: "Referral Rewards",
    description: "Earn 100 coins for each friend you refer who makes their first booking",
    discountPercentage: 0,
    bonusCoins: 100,
    minimumPurchase: 0,
    validUntil: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // 60 days from now
    isActive: true,
  },
  {
    title: "Premium Package Deal",
    description: "Book any 3 premium services and get 30% off on the total amount",
    discountPercentage: 30,
    bonusCoins: 0,
    minimumPurchase: 2000,
    validUntil: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000), // 45 days from now
    isActive: true,
  },
  {
    title: "Loyalty Program",
    description: "Complete 10 bookings and unlock VIP status with exclusive perks",
    discountPercentage: 0,
    bonusCoins: 200,
    minimumPurchase: 0,
    validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days from now
    isActive: true,
  },
  {
    title: "Weekend Special",
    description: "Flat 15% discount on all services every weekend",
    discountPercentage: 15,
    bonusCoins: 0,
    minimumPurchase: 300,
    validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
    isActive: true,
  }
];

const createSampleDeals = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Connected');

    // Clear existing deals
    await ExclusiveDeal.deleteMany({});
    console.log('Cleared existing deals');

    // Insert sample deals
    const deals = await ExclusiveDeal.insertMany(sampleDeals);
    console.log(`Created ${deals.length} sample exclusive deals`);

    // Log the created deals
    deals.forEach((deal, index) => {
      console.log(`${index + 1}. ${deal.title} - ${deal.description}`);
    });

    console.log('Sample deals created successfully!');
  } catch (error) {
    console.error('Error creating sample deals:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
};

// Run the script
createSampleDeals();
