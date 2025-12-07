const cron = require('node-cron');
const Notification = require('../models/Notification');

const startNotificationCleaner = () => {
  // Schedule a job to run once every day at 12:01 AM
  cron.schedule('1 0 * * *', async () => {
    console.log('Running notification cleanup job...');
    const twentyTwoDaysAgo = new Date();
    twentyTwoDaysAgo.setDate(twentyTwoDaysAgo.getDate() - 22); // Subtract 22 days

    try {
      const result = await Notification.deleteMany({
        date: { $lt: twentyTwoDaysAgo },
      });
      console.log(`Deleted ${result.deletedCount} old notifications.`);
    } catch (error) {
      console.error('Error during notification cleanup:', error);
    }
  });
};

module.exports = startNotificationCleaner;
