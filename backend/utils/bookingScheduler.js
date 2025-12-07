const cron = require('node-cron');
const Booking = require('../models/Booking');
const Notification = require('../models/Notification');
const User = require('../models/User');

const startBookingScheduler = () => {
  // Schedule a task to run every 5 minutes to check for expired bookings
  cron.schedule('*/5 * * * *', async () => {
    console.log('Running booking expiry check...');
    // The booking cancellation logic is based on payment status and creation time.
    // If a booking is pending payment and older than 1 minute, it gets cancelled.
    // This specific logic (1 minute timeout) is independent of the daily cron schedule.
    // The daily cron will simply check for any such bookings that might have been missed
    // or are still pending for some reason.
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000); // 1 minute ago

    try {
      const expiredBookings = await Booking.find({
        paymentStatus: 'pending',
        status: 'pending',
        createdAt: { $lt: oneMinuteAgo },
      });

      if (expiredBookings.length > 0) {
        console.log(`Found ${expiredBookings.length} expired bookings.`);
      }

      for (const booking of expiredBookings) {
        booking.status = 'cancelled';
        booking.cancellationReason = 'Payment not completed within 1 minute.';
        await booking.save();
        console.log(`Booking ${booking._id} cancelled due to payment timeout.`);

        // Notify the user
        const user = await User.findById(booking.userId);
        if (user) {
          const notification = new Notification({
            userId: user._id,
            title: 'Booking Cancelled',
            message: `Your booking with ${booking.barberId} on ${new Date(booking.date).toLocaleDateString()} at ${booking.time} was cancelled because payment was not completed within 1 minute.`,
          });
          await notification.save();
        }

        // Notify the barber
        const barber = await User.findById(booking.barberId);
        if (barber) {
          const notification = new Notification({
            userId: barber._id,
            title: 'Booking Cancelled (Payment Timeout)',
            message: `A booking from ${user ? user.name : 'a user'} on ${new Date(booking.date).toLocaleDateString()} at ${booking.time} was cancelled due to payment timeout.`,
          });
          await notification.save();
        }
      }
    } catch (error) {
      console.error('Error in booking expiry check:', error);
    }
  });
};

module.exports = startBookingScheduler;
