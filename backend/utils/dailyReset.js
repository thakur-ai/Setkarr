const User = require('../models/User');
const cron = require('node-cron');

// Function to reset todaysBookings for all users
const resetTodaysBookings = async () => {
  try {
    console.log('Starting daily reset of todaysBookings...');

    // Reset todaysBookings to 0 for all users
    const result = await User.updateMany(
      {},
      { $set: { todaysBookings: 0 } }
    );

    console.log(`Successfully reset todaysBookings for ${result.modifiedCount} users`);
  } catch (error) {
    console.error('Error resetting todaysBookings:', error);
  }
};

// Schedule the reset to run every day at midnight IST
const scheduleDailyReset = () => {
  // Run every day at 00:00 (midnight) IST
  cron.schedule('0 0 * * *', () => {
    console.log('Running scheduled daily reset of todaysBookings at midnight IST');
    resetTodaysBookings();
  }, {
    timezone: "Asia/Kolkata" // Set timezone to IST
  });

  console.log('Daily reset scheduler initialized - will run at midnight IST (start of new day)');
};

// Export functions for manual use and testing
module.exports = {
  resetTodaysBookings,
  scheduleDailyReset
};
