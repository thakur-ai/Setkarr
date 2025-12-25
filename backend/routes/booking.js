const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const Notification = require('../models/Notification');
const User = require('../models/User');
const SetkarCoinTransaction = require('../models/SetkarCoinTransaction');
const auth = require('../middleware/auth');

// Simple in-memory cache for premium availability (use Redis in production)
const premiumCache = new Map();
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

// Helper function to get priority value
const getPriorityValue = (appointment) => {
  const type = appointment.appointmentType;
  const isOffline = !!appointment.isOfflineBooking; // Ensure boolean value
  let basePriority;

  if (!type) {
    // If no type is specified, assign a default base priority.
    // Offline bookings without a type will default to 'Basic' priority.
    basePriority = 3; // Assuming 'Basic' is priority 3
  } else {
    const lowerCaseType = type.toLowerCase();
    if (lowerCaseType.includes('black')) basePriority = 1;
    else if (lowerCaseType.includes('premium')) basePriority = 2;
    else if (lowerCaseType.includes('basic')) basePriority = 3;
    else if (lowerCaseType.includes('free')) basePriority = 4;
    else basePriority = 5; // Default for unrecognized types
  }

  // If it's an offline booking, slightly increase its priority value
  // to place it after online bookings of the same base priority.
  return isOffline ? basePriority + 0.5 : basePriority;
};

// @route   GET api/booking/history
// @desc    Get user's booking history
// @access  Private
router.get('/history', auth, async (req, res) => {
  try {
    const bookings = await Booking.find({ userId: req.user.id, status: { $ne: 'cancelled' } })
      .populate('barberId', 'name email phone address rating reviews profilePicture shopName shopAddress shopPhone shopRating shopReviews') // Populate barberId including profilePicture
      .select('+otp') // Include the OTP field
      .sort({ date: -1 });
    res.json(bookings);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: err.message });
  }
});

// @route   GET api/booking/barber
// @desc    Get all bookings for the authenticated barber
// @access  Private
router.get('/barber', auth, async (req, res) => {
  try {
    console.log('Logged-in barber ID:', req.user.id);
    const bookings = await Booking.find({ barberId: req.user.id, status: { $ne: 'cancelled' } })
      .populate('userId', 'name email profilePicture phone gender language') // Populate userId with relevant fields
      .sort({ date: -1, time: 1 }); // Sort by date (desc) and time (asc)
    console.log('Bookings:', bookings);
    res.json(bookings);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: err.message });
  }
});

// @route   GET api/booking/barber/:barberId/all
// @desc    Get all bookings for a specific barber (for shop statistics)
// @access  Public
router.get('/barber/:barberId/all', async (req, res) => {
  try {
    const bookings = await Booking.find({
      barberId: req.params.barberId,
      status: { $ne: 'cancelled' }
    }).sort({ date: -1, time: 1 });

    res.json(bookings);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: err.message });
  }
});

// @route   GET api/booking/check-premium-availability-batch
// @desc    Check premium availability for multiple barbers at once (NO CACHING for real-time accuracy)
// @access  Private
router.get('/check-premium-availability-batch', auth, async (req, res) => {
  try {
    const { barberIds, date } = req.query;

    if (!barberIds || !date) {
      return res.status(400).json({ msg: 'barberIds and date are required' });
    }

    const ids = barberIds.split(',');
    const queryDate = new Date(date);
    queryDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(queryDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const barbers = await User.find({ _id: { $in: ids } });

    const results = {};
    for (const barber of barbers) {
      const todaysBookings = await Booking.countDocuments({
        barberId: barber._id,
        date: { $gte: queryDate, $lt: nextDay },
        status: { $ne: 'cancelled' },
      });

      if (todaysBookings < barber.maxAppointmentsPerDay) {
        const remainingSlots = barber.maxAppointmentsPerDay - todaysBookings;
        results[barber._id] = { type: 'free', count: remainingSlots };
      } else {
        const replaceableBookings = await Booking.countDocuments({
          barberId: barber._id,
          date: { $gte: queryDate, $lt: nextDay },
          status: { $nin: ['started', 'completed', 'cancelled'] },
          appointmentType: { $in: ['Free', 'Basic', 'Premium'] },
        });
        results[barber._id] = { type: 'premium', count: replaceableBookings };
      }
    }

    res.json(results);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: err.message });
  }
});

// @route   GET api/booking/:id
// @desc    Get booking by ID
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('barberId', 'name email phone address rating reviews profilePicture shopName shopAddress shopPhone') // Populate barberId including all necessary fields
      .populate('userId', 'name email profilePicture phone gender language');
    if (!booking) {
      return res.status(404).json({ msg: 'Booking not found' });
    }
    // Return booking with OTP for authenticated users (for display on website)
    const bookingResponse = await Booking.findById(booking._id).select('+otp').populate('barberId', 'name email phone address rating reviews profilePicture shopName shopAddress shopPhone');
    res.json(bookingResponse);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: err.message });
  }
});

// @route   PUT api/booking/accept/:id
// @desc    Accept a booking
// @access  Private
router.put('/accept/:id', auth, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ msg: 'Booking not found' });
    }

    if (booking.barberId.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'User not authorized' });
    }

    booking.status = 'confirmed';
    await booking.save();

    const updatedBooking = await Booking.findById(req.params.id).populate('userId', 'name email profilePicture phone gender language');

    // Create a notification for the user
    const user = await User.findById(booking.userId);
    if (user) {
      const bookingDate = new Date(booking.date);
      const [hours, minutes] = booking.time.split(':');
      bookingDate.setHours(hours);
      bookingDate.setMinutes(minutes);

      const formattedDate = bookingDate.toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Asia/Kolkata',
      });
      const formattedTime = bookingDate.toLocaleTimeString('en-IN', {
        hour: 'numeric',
        minute: 'numeric',
        hour12: true,
        timeZone: 'Asia/Kolkata',
      });

      const notification = new Notification({
        userId: user._id,
        title: 'Booking Confirmed',
        message: `Your booking with ${req.user.name} on ${formattedDate} at ${formattedTime} has been confirmed.`,
      });
      await notification.save();
    }

    res.json(updatedBooking);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: err.message });
  }
});

// @route   POST api/booking/verify-otp-and-start/:id
// @desc    Verify OTP and start a booking
// @access  Private
router.post('/verify-otp-and-start/:id', auth, async (req, res) => {
  try {
    const { otp } = req.body;
    const booking = await Booking.findById(req.params.id).select('+otp');

    if (!booking) {
      return res.status(404).json({ msg: 'Booking not found' });
    }

    // Check if the logged-in user is the barber for this booking
    if (booking.barberId.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'User not authorized' });
    }

    // Bypass OTP verification for offline bookings
    if (!booking.isOfflineBooking) {
      if (booking.otp !== otp) {
        return res.status(400).json({ msg: 'Invalid OTP' });
      }
    }

    booking.status = 'started';
    await booking.save();

    const updatedBooking = await Booking.findById(req.params.id).populate('userId', 'name email profilePicture phone gender language');

    // Create a notification for the user
    const user = await User.findById(booking.userId);
    if (user) {
      const bookingDate = new Date(booking.date);
      const [hours, minutes] = booking.time.split(':');
      bookingDate.setHours(hours);
      bookingDate.setMinutes(minutes);

      const formattedDate = bookingDate.toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Asia/Kolkata',
      });
      const formattedTime = bookingDate.toLocaleTimeString('en-IN', {
        hour: 'numeric',
        minute: 'numeric',
        hour12: true,
        timeZone: 'Asia/Kolkata',
      });

      const notification = new Notification({
        userId: user._id,
        title: 'Booking Started',
        message: `Your booking with ${req.user.name} on ${formattedDate} at ${formattedTime} has started.`,
      });
      await notification.save();
    }

    res.json(updatedBooking);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: err.message });
  }
});

// @route   PUT api/booking/decline/:id
// @desc    Decline a booking
// @access  Private
router.put('/decline/:id', auth, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ msg: 'Booking not found' });
    }

    if (booking.barberId.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'User not authorized' });
    }

    // Check for higher priority appointments with pending payments
    const currentBookingPriority = getPriorityValue(booking.appointmentType);
    const higherPriorityPendingPaymentBookings = await Booking.find({
      barberId: booking.barberId,
      date: booking.date, // Check for the same day
      paymentStatus: 'pending',
      status: { $in: ['confirmed', 'pending'] }, // Only consider confirmed or pending status
    });

    const hasBlockingHigherPriority = higherPriorityPendingPaymentBookings.some(
      (hpBooking) => getPriorityValue(hpBooking.appointmentType) < currentBookingPriority
    );

    if (hasBlockingHigherPriority) {
      return res.status(400).json({
        msg: 'Cannot decline this appointment. A higher priority appointment has pending payments.',
      });
    }

    booking.status = 'cancelled';
    await booking.save();

    // Reinstate a displaced booking if applicable
    const displacedBooking = await Booking.findOne({
      barberId: booking.barberId,
      status: 'cancelled',
      cancellationReason: 'Cancelled due to a higher priority booking.',
    }).sort({ createdAt: -1 });

    if (displacedBooking) {
      // Remove booking total price from Setkar Coins if reinstated
      const displacedUser = await User.findById(displacedBooking.userId);
      if (displacedUser) {
        displacedUser.setkarCoins = Math.max(0, (displacedUser.setkarCoins || 0) - displacedBooking.totalPrice);
        await displacedUser.save();

        const notification = new Notification({
          userId: displacedUser._id,
          title: 'Booking Reinstated',
          message: `Your previously cancelled booking with a higher priority booking has been reinstated. ${displacedBooking.totalPrice} Setkar Coins have been removed from your account.`,
        });
        await notification.save();
      }

      displacedBooking.status = 'confirmed';
      displacedBooking.cancellationReason = '';
      await displacedBooking.save();
    }

    const updatedBooking = await Booking.findById(req.params.id).populate('userId', 'name email profilePicture phone gender language');

     // Create a notification for the user
     const user = await User.findById(booking.userId);
     if (user) {
        const bookingDate = new Date(booking.date);
        const [hours, minutes] = booking.time.split(':');
        bookingDate.setHours(hours);
        bookingDate.setMinutes(minutes);

        const formattedDate = bookingDate.toLocaleDateString('en-IN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: 'Asia/Kolkata',
        });
        const formattedTime = bookingDate.toLocaleTimeString('en-IN', {
            hour: 'numeric',
            minute: 'numeric',
            hour12: true,
            timeZone: 'Asia/Kolkata',
        });

       const notification = new Notification({
         userId: user._id,
         title: 'Booking Declined',
         message: `Your booking with ${req.user.name} on ${formattedDate} at ${formattedTime} has been declined.`,
       });
       await notification.save();
     }

    res.json(updatedBooking);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: err.message });
  }
});

// @route   PUT api/booking/cancel/:id
// @desc    Cancel a booking
// @access  Private
router.put('/cancel/:id', auth, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ msg: 'Booking not found' });
    }

    if (booking.userId.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'User not authorized' });
    }

    // Check for higher priority appointments with pending payments for the same barber
    const currentBookingPriority = getPriorityValue(booking.appointmentType);
    const higherPriorityPendingPaymentBookings = await Booking.find({
      barberId: booking.barberId,
      date: booking.date, // Check for the same day
      paymentStatus: 'pending',
      status: { $in: ['confirmed', 'pending'] }, // Only consider confirmed or pending status
      _id: { $ne: booking._id }, // Exclude the current booking itself
    });

    const hasBlockingHigherPriority = higherPriorityPendingPaymentBookings.some(
      (hpBooking) => getPriorityValue(hpBooking.appointmentType) < currentBookingPriority
    );

    if (hasBlockingHigherPriority) {
      return res.status(400).json({
        msg: 'Cannot cancel this appointment. A higher priority appointment has pending payments.',
      });
    }

    // Check if payment is already completed
    if (booking.paymentStatus === 'completed') {
      console.warn(`Attempted to cancel booking ${booking._id} but payment was already completed.`);
      return res.status(400).json({ msg: 'Booking cannot be cancelled as payment is already completed.' });
    }

    booking.status = 'cancelled';
    await booking.save();

    // Reinstate a displaced booking if applicable
    const displacedBooking = await Booking.findOne({
      barberId: booking.barberId,
      status: 'cancelled',
      cancellationReason: 'Cancelled due to a higher priority booking.',
    }).sort({ createdAt: -1 });

    if (displacedBooking) {
      displacedBooking.status = 'confirmed';
      displacedBooking.cancellationReason = '';
      await displacedBooking.save();
    }

    const io = req.app.get('io');
    io.emit('bookingCancelled', booking);

    res.json(booking);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: err.message });
  }
});

// @route   PUT api/booking/cancel-pending/:id
// @desc    Cancel a booking with pending payment and reinstate the previous booking
// @access  Private
router.put('/cancel-pending/:id', auth, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ msg: 'Booking not found' });
    }

    if (booking.userId.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'User not authorized' });
    }

    if (booking.paymentStatus !== 'pending') {
      return res.status(400).json({ msg: 'Booking is not in pending payment state' });
    }

    // Find the booking that was cancelled to make space for this one
    const displacedBooking = await Booking.findOne({
      barberId: booking.barberId,
      status: 'cancelled',
      cancellationReason: 'Cancelled due to a higher priority booking.',
    }).sort({ createdAt: -1 });

    if (displacedBooking) {
      displacedBooking.status = 'confirmed';
      displacedBooking.cancellationReason = '';
      await displacedBooking.save();
    }

    booking.status = 'cancelled';
    await booking.save();

    res.json({ msg: 'Booking cancelled and previous booking reinstated' });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: err.message });
  }
});

// @route   POST api/booking/verify-otp
// @desc    Verify OTP for a booking
// @access  Private
router.post('/verify-otp', auth, async (req, res) => {
  try {
    const { bookingId, otp } = req.body;
    const booking = await Booking.findById(bookingId).select('+otp');

    if (!booking) {
      return res.status(404).json({ msg: 'Booking not found' });
    }

    if (booking.otp !== otp) {
      return res.status(400).json({ msg: 'Invalid OTP' });
    }

    res.json({ status: 'success', message: 'OTP verified' });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: err.message });
  }
});


// @route   PUT api/booking/complete/:id
// @desc    Complete a booking
// @access  Private
router.put('/complete/:id', auth, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ msg: 'Booking not found' });
    }

    // Check if the logged-in user is the barber for this booking
    if (booking.barberId.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'User not authorized' });
    }

    // Check for higher priority appointments with pending payments
    const currentBookingPriority = getPriorityValue(booking.appointmentType);
    const higherPriorityPendingPaymentBookings = await Booking.find({
      barberId: booking.barberId,
      date: booking.date, // Check for the same day
      paymentStatus: 'pending',
      status: { $in: ['confirmed', 'pending', 'started'] }, // Consider confirmed, pending, or started status
      _id: { $ne: booking._id }, // Exclude the current booking itself
    });

    const hasBlockingHigherPriority = higherPriorityPendingPaymentBookings.some(
      (hpBooking) => getPriorityValue(hpBooking.appointmentType) < currentBookingPriority
    );

    if (hasBlockingHigherPriority) {
      return res.status(400).json({
        msg: 'Cannot complete this appointment. A higher priority appointment has pending payments.',
      });
    }

    booking.status = 'completed';
    if (booking.isOfflineBooking) {
      booking.paymentStatus = 'completed'; // Mark payment as completed for offline bookings
    }
    await booking.save();

    // Increment todaysBookings for the barber
    const barberUser = await User.findById(booking.barberId);
    if (barberUser) {
      barberUser.todaysBookings = (barberUser.todaysBookings || 0) + 1;
      await barberUser.save();
    }

    const updatedBooking = await Booking.findById(req.params.id).populate('userId', 'name email profilePicture phone gender language');

    // Award 1 Setkar coin to the user upon booking completion
    const user = await User.findById(booking.userId);
    if (user) {
      // Increment completed bookings count
      user.completedBookings = (user.completedBookings || 0) + 1;

      // Award regular coin
      user.setkarCoins = (user.setkarCoins || 0) + 1;

      // Check for loyalty program milestone (every 10 bookings)
      const currentMilestone = Math.floor((user.completedBookings - 1) / 10) + 1; // Current milestone before this booking
      const newMilestone = Math.floor(user.completedBookings / 10); // New milestone after this booking

      let loyaltyReward = 0;
      if (newMilestone > currentMilestone) {
        // User reached a new milestone
        loyaltyReward = 10; // Award 10 coins for every 10 bookings
        user.setkarCoins += loyaltyReward;
        user.loyaltyRewardsEarned = (user.loyaltyRewardsEarned || 0) + 1;
        user.lastLoyaltyRewardDate = new Date();
      }

      await user.save();

      // Create transaction record for regular coin
      const regularTransaction = new SetkarCoinTransaction({
        userId: user._id,
        type: 'recharge',
        amount: 1,
        description: `Earned 1 Setkar Coin for completing booking`,
      });
      await regularTransaction.save();

      // Create transaction record for loyalty reward if applicable
      if (loyaltyReward > 0) {
        const loyaltyTransaction = new SetkarCoinTransaction({
          userId: user._id,
          type: 'recharge',
          amount: loyaltyReward,
          description: `Loyalty reward: ${loyaltyReward} Setkar Coins for completing ${user.completedBookings} bookings`,
        });
        await loyaltyTransaction.save();
      }

      const bookingDate = new Date(booking.date);
      const [hours, minutes] = booking.time.split(':');
      bookingDate.setHours(hours);
      bookingDate.setMinutes(minutes);

      const formattedDate = bookingDate.toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Asia/Kolkata',
      });
      const formattedTime = bookingDate.toLocaleTimeString('en-IN', {
        hour: 'numeric',
        minute: 'numeric',
        hour12: true,
        timeZone: 'Asia/Kolkata',
      });

      let notificationMessage = `Your booking with ${req.user.name} on ${formattedDate} at ${formattedTime} has been completed. You earned 1 Setkar Coin!`;
      if (loyaltyReward > 0) {
        notificationMessage += ` 🎉 Loyalty bonus: ${loyaltyReward} extra coins for completing ${user.completedBookings} bookings!`;
      }

      const notification = new Notification({
        userId: user._id,
        title: 'Booking Completed',
        message: notificationMessage,
      });
      await notification.save();
    }

    // Create a notification for the barber as well
    const barber = await User.findById(booking.barberId);
    if (barber) {
      const bookingDate = new Date(booking.date);
      const [hours, minutes] = booking.time.split(':');
      bookingDate.setHours(hours);
      bookingDate.setMinutes(minutes);

      const formattedDate = bookingDate.toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Asia/Kolkata',
      });
      const formattedTime = bookingDate.toLocaleTimeString('en-IN', {
        hour: 'numeric',
        minute: 'numeric',
        hour12: true,
        timeZone: 'Asia/Kolkata',
      });

      const customerIdentifier = updatedBooking.isOfflineBooking ? updatedBooking.customerName : updatedBooking.userId.name;
      const barberNotification = new Notification({
        userId: barber._id,
        title: 'Booking Completed',
        message: `Booking for ${customerIdentifier} on ${formattedDate} at ${formattedTime} has been completed.`,
      });
      await barberNotification.save();
    }

    res.json(updatedBooking);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: err.message });
  }
});

// @route   POST api/booking
// @desc    Create a new booking
// @access  Private
router.post('/', auth, async (req, res) => {
  console.log('Booking request body:', req.body);
  const { barberId, date, time, services, totalPrice, appointmentType, isOfflineBooking, customerName, customerPhone } = req.body;

  try {
    const barber = await User.findById(barberId);
    if (!barber) {
      return res.status(404).json({ msg: 'Barber not found' });
    }

    const today = new Date(date);
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todaysBookings = await Booking.countDocuments({
      barberId,
      date: {
        $gte: today,
        $lt: tomorrow,
      },
      status: { $ne: 'cancelled' },
    });

    if (todaysBookings >= barber.maxAppointmentsPerDay) {
      if (appointmentType !== 'Black Premium') {
        return res.status(400).json({ msg: 'This barber is fully booked for today.' });
      }

      const priority = ['Free', 'Basic', 'Premium'];
      let bookingToCancel = null;

      for (const type of priority) {
        const bookings = await Booking.find({
          barberId,
          date: { $gte: today, $lt: tomorrow },
          status: { $nin: ['started', 'completed', 'cancelled'] },
          appointmentType: type,
        }).sort({ createdAt: -1 });

        if (bookings.length > 0) {
          bookingToCancel = bookings[0];
          break;
        }
      }

      if (bookingToCancel) {
        bookingToCancel.status = 'cancelled';
        bookingToCancel.cancellationReason = 'Cancelled due to a higher priority booking.';
        await bookingToCancel.save();

        const cancelledUser = await User.findById(bookingToCancel.userId);
        if (cancelledUser) {
          let coinsToAdd = 0;
          switch (bookingToCancel.appointmentType) {
            case 'Free':
              coinsToAdd = 0;
              break;
            case 'Basic':
              coinsToAdd = 3;
              break;
            case 'Premium':
              coinsToAdd = 10;
              break;
            case 'Black Premium':
              coinsToAdd = 15;
              break;
            default:
              coinsToAdd = 0; // Default to 0 if type is unrecognized
          }

          cancelledUser.setkarCoins = (cancelledUser.setkarCoins || 0) + coinsToAdd;
          await cancelledUser.save();

          const notification = new Notification({
            userId: cancelledUser._id,
            title: 'Booking Cancelled',
            message: `Your booking with ${barber.name} has been cancelled due to a higher priority booking. ${coinsToAdd} Setkar Coins have been added to your account.`,
          });
          await notification.save();
        }
      } else {
        return res.status(400).json({ msg: 'This barber is fully booked with high priority appointments.' });
      }
    }

    // Generate a 6-digit OTP only for online bookings
    const otp = isOfflineBooking ? undefined : Math.floor(100000 + Math.random() * 900000).toString();

    const newBooking = new Booking({
      userId: isOfflineBooking ? undefined : req.user.id, // userId is optional for offline bookings
      barberId,
      date,
      time,
      services,
      totalPrice,
      appointmentType,
      isOfflineBooking: isOfflineBooking || false,
      customerName: customerName || undefined,
      customerPhone: customerPhone || undefined,
      paymentStatus: isOfflineBooking ? 'completed' : 'pending', // Set paymentStatus to 'completed' for offline bookings
      otp, // Save the generated OTP
    });

    const booking = await newBooking.save();

    // Send OTP to the user (e.g., via SMS or email - this is a placeholder)
    if (otp) {
      console.log(`OTP for booking ${booking._id}: ${otp}`);
      // In a real application, you would integrate with an SMS or email service here.
    }

    // Create a notification for the barber
    const barberForNotification = await User.findById(barberId);
    if (barberForNotification) {
      const bookingDate = new Date(date);
      const [hours, minutes] = time.split(':');
      bookingDate.setHours(hours);
      bookingDate.setMinutes(minutes);

      const formattedDate = bookingDate.toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Asia/Kolkata',
      });
      const formattedTime = bookingDate.toLocaleTimeString('en-IN', {
        hour: 'numeric',
        minute: 'numeric',
        hour12: true,
        timeZone: 'Asia/Kolkata',
      });

      const serviceNames = Array.isArray(services) ? services.map(service => service.name).join(', ') : 'a service';
      const customerIdentifier = isOfflineBooking ? customerName : req.user.name;

      const notification = new Notification({
        userId: barberForNotification._id,
        title: 'New Booking',
        message: `You have a new booking from ${customerIdentifier} for ${serviceNames} on ${formattedDate} at ${formattedTime}.`,
      });
      await notification.save();
    }

    res.json(booking);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: err.message });
  }
});

// @route   GET api/booking/daily-counts/:barberId
// @desc    Get daily appointhdjhuryitloaggdftywuiloment counts by type for a specific barber
// @access  Private (or Public if needed for customer-facing availability)
router.get('/daily-counts/:barberId', auth, async (req, res) => {
  try {
    const { barberId } = req.params;
    const { date } = req.query;

    const queryDate = new Date(date);
    queryDate.setHours(0, 0, 0, 0);

    const nextDay = new Date(queryDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const appointments = await Booking.find({
      barberId,
      date: {
        $gte: queryDate,
        $lt: nextDay,
      },
      status: { $ne: 'cancelled' },
    });

    const counts = appointments.reduce((acc, appointment) => {
      acc[appointment.appointmentType] = (acc[appointment.appointmentType] || 0) + 1;
      return acc;
    }, {});

    res.json(counts);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: err.message });
  }
});

// @route   GET api/booking/barber-appointments/:barberId
// @desc    Get all bookings for a specific barber on a specific date
// @access  Private
router.get('/barber-appointments/:barberId', auth, async (req, res) => {
  try {
    const { barberId } = req.params;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ msg: 'Date query parameter is required' });
    }

    const queryDate = new Date(date);
    queryDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(queryDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const bookings = await Booking.find({
      barberId: barberId,
      date: {
        $gte: queryDate,
        $lt: nextDay,
      },
      status: { $ne: 'cancelled' },
    }).populate('userId', 'name _id').populate('services', 'name price').select('customerName isOfflineBooking date time appointmentType totalPrice status services paymentStatus').sort({ createdAt: 1 });

    const priorityMap = {
      'Black Premium': 1,
      'Premium': 2,
      'Basic': 3,
      'Free': 4,
    };

    bookings.sort((a, b) => {
      const priorityA = getPriorityValue(a);
      const priorityB = getPriorityValue(b);
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      // Secondary sort by time for same priority
      if (typeof a.time === 'string' && typeof b.time === 'string' && a.time && b.time) {
        try {
          const timeA = new Date(`1970/01/01 ${a.time}`);
          const timeB = new Date(`1970/01/01 ${b.time}`);
          if (!isNaN(timeA) && !isNaN(timeB)) {
            return timeA - timeB;
          }
        } catch (e) {
          console.error("Error parsing time for backend sorting:", e, "Appointment A:", a, "Appointment B:", b);
        }
      }
      return new Date(a.createdAt) - new Date(b.createdAt);
    });

    res.json(bookings);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: err.message });
  }
});

// @route   GET api/booking/barber-appointments-batch
// @desc    Get all bookings for multiple barbers on a specific date (for calculating todays bookings)
// @access  Private
router.get('/barber-appointments-batch', auth, async (req, res) => {
  try {
    const { barberIds, date } = req.query;

    if (!barberIds || !date) {
      return res.status(400).json({ msg: 'barberIds and date are required' });
    }

    const ids = barberIds.split(',');
    const queryDate = new Date(date);
    queryDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(queryDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const bookings = await Booking.find({
      barberId: { $in: ids },
      date: {
        $gte: queryDate,
        $lt: nextDay,
      },
      status: { $ne: 'cancelled' },
    }).select('barberId status').sort({ createdAt: 1 });

    // Group bookings by barberId and count confirmed/started bookings
    const bookingCounts = {};
    ids.forEach(id => {
      bookingCounts[id] = 0;
    });

    bookings.forEach(booking => {
      if (booking.status === 'confirmed' || booking.status === 'started') {
        bookingCounts[booking.barberId.toString()] = (bookingCounts[booking.barberId.toString()] || 0) + 1;
      }
    });

    res.json(bookingCounts);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: err.message });
  }
});

// @route   GET api/booking/check-premium-availability/:barberId
// @desc    Check if a Black Premium appointment can be booked
// @access  Private
router.get('/check-premium-availability/:barberId', auth, async (req, res) => {
  try {
    const { barberId } = req.params;
    const { date } = req.query;

    const queryDate = new Date(date);
    queryDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(queryDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const barber = await User.findById(barberId);
    if (!barber) {
      return res.status(404).json({ msg: 'Barber not found' });
    }

    const todaysBookings = await Booking.countDocuments({
      barberId,
      date: { $gte: queryDate, $lt: nextDay },
      status: { $ne: 'cancelled' },
    });

    if (todaysBookings < barber.maxAppointmentsPerDay) {
      const remainingSlots = barber.maxAppointmentsPerDay - todaysBookings;
      return res.json({ type: 'free', count: remainingSlots });
    }

    console.log(`Barber ${barberId} is full. Bookings: ${todaysBookings}, Max: ${barber.maxAppointmentsPerDay}`);

    const replaceableBookings = await Booking.countDocuments({
      barberId,
      date: { $gte: queryDate, $lt: nextDay },
      status: { $nin: ['started', 'completed', 'cancelled'] },
      appointmentType: { $in: ['Free', 'Basic', 'Premium'] },
    });

    console.log(`Found ${replaceableBookings} replaceable bookings for barber ${barberId}`);

    res.json({ type: 'premium', count: replaceableBookings });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: err.message });
  }
});

// @route   GET api/booking/check-premium-availability-batch
// @desc    Check premium availability for multiple barbers at once
// @access  Private
router.get('/check-premium-availability-batch', auth, async (req, res) => {
  try {
    const { barberIds, date } = req.query;

    if (!barberIds || !date) {
      return res.status(400).json({ msg: 'barberIds and date are required' });
    }

    const cacheKey = `premium_batch_${barberIds}_${date}`;
    // const cached = premiumCache.get(cacheKey);
    // if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
    //   return res.json(cached.data);
    // }

    const ids = barberIds.split(',');
    const queryDate = new Date(date);
    queryDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(queryDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const barbers = await User.find({ _id: { $in: ids } });

    const results = {};
    for (const barber of barbers) {
      const todaysBookings = await Booking.countDocuments({
        barberId: barber._id,
        date: { $gte: queryDate, $lt: nextDay },
        status: { $ne: 'cancelled' },
      });

      if (todaysBookings < barber.maxAppointmentsPerDay) {
        const remainingSlots = barber.maxAppointmentsPerDay - todaysBookings;
        results[barber._id] = { type: 'free', count: remainingSlots };
      } else {
        const replaceableBookings = await Booking.countDocuments({
          barberId: barber._id,
          date: { $gte: queryDate, $lt: nextDay },
          status: { $nin: ['started', 'completed', 'cancelled'] },
          appointmentType: { $in: ['Free', 'Basic', 'Premium'] },
        });
        results[barber._id] = { type: 'premium', count: replaceableBookings };
      }
    }

    // Cache the results
    premiumCache.set(cacheKey, { data: results, timestamp: Date.now() });

    res.json(results);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: err.message });
  }
});

// @route   GET api/booking/website/barber-queue/:barberId
// @desc    Get barber's queue for a specific date for website (public access, same logic as mobile Appointmentcheckpage)
// @access  Public
router.get('/website/barber-queue/:barberId', async (req, res) => {
  try {
    const { barberId } = req.params;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ msg: 'Date query parameter is required' });
    }

    const queryDate = new Date(date);
    queryDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(queryDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const bookings = await Booking.find({
      barberId: barberId,
      date: {
        $gte: queryDate,
        $lt: nextDay,
      },
      status: { $ne: 'cancelled' },
    }).populate('userId', 'name _id').populate('services', 'name price').select('customerName isOfflineBooking date time appointmentType totalPrice status services paymentStatus').sort({ createdAt: 1 });

    // Sort by priority (same logic as Appointmentcheckpage.jsx)
    bookings.sort((a, b) => {
      const priorityA = getPriorityValue(a);
      const priorityB = getPriorityValue(b);
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      // Secondary sort by time for same priority
      if (typeof a.time === 'string' && typeof b.time === 'string' && a.time && b.time) {
        try {
          const timeA = new Date(`1970/01/01 ${a.time}`);
          const timeB = new Date(`1970/01/01 ${b.time}`);
          if (!isNaN(timeA) && !isNaN(timeB)) {
            return timeA - timeB;
          }
        } catch (e) {
          console.error("Error parsing time for backend sorting:", e);
        }
      }
      return new Date(a.createdAt) - new Date(b.createdAt);
    });

    res.json(bookings);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: err.message });
  }
});

// @route   GET api/booking/public/barber-queue/:barberId
// @desc    Get barber's queue for a specific date (public access for queue checking)
// @access  Public
router.get('/public/barber-queue/:barberId', async (req, res) => {
  try {
    const { barberId } = req.params;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ msg: 'Date query parameter is required' });
    }

    const queryDate = new Date(date);
    queryDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(queryDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const bookings = await Booking.find({
      barberId: barberId,
      date: {
        $gte: queryDate,
        $lt: nextDay,
      },
      status: { $ne: 'cancelled' },
    }).populate('userId', 'name _id').populate('services', 'name price').select('customerName isOfflineBooking date time appointmentType totalPrice status services paymentStatus').sort({ createdAt: 1 });

    const priorityMap = {
      'Black Premium': 1,
      'Premium': 2,
      'Basic': 3,
      'Free': 4,
    };

    bookings.sort((a, b) => {
      const priorityA = getPriorityValue(a);
      const priorityB = getPriorityValue(b);
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      // Secondary sort by time for same priority
      if (typeof a.time === 'string' && typeof b.time === 'string' && a.time && b.time) {
        try {
          const timeA = new Date(`1970/01/01 ${a.time}`);
          const timeB = new Date(`1970/01/01 ${b.time}`);
          if (!isNaN(timeA) && !isNaN(timeB)) {
            return timeA - timeB;
          }
        } catch (e) {
          console.error("Error parsing time for backend sorting:", e, "Appointment A:", a, "Appointment B:", b);
        }
      }
      return new Date(a.createdAt) - new Date(b.createdAt);
    });

    res.json(bookings);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: err.message });
  }
});

// @route   POST api/booking/public
// @desc    Create a public booking (no authentication required)
// @access  Public
router.post('/public', async (req, res) => {
  console.log('Public booking endpoint called');
  console.log('Public booking request body:', req.body);
  const { barberId, date, time, services, totalPrice, appointmentType, customerInfo } = req.body;

  try {
    const barber = await User.findById(barberId);
    if (!barber) {
      return res.status(404).json({ msg: 'Barber not found' });
    }

    const today = new Date(date);
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todaysBookings = await Booking.countDocuments({
      barberId,
      date: {
        $gte: today,
        $lt: tomorrow,
      },
      status: { $ne: 'cancelled' },
    });

    if (todaysBookings >= barber.maxAppointmentsPerDay) {
      if (appointmentType !== 'Black Premium') {
        return res.status(400).json({ msg: 'This barber is fully booked for today.' });
      }

      const priority = ['Free', 'Basic', 'Premium'];
      let bookingToCancel = null;

      for (const type of priority) {
        const bookings = await Booking.find({
          barberId,
          date: { $gte: today, $lt: tomorrow },
          status: { $nin: ['started', 'completed', 'cancelled'] },
          appointmentType: type,
        }).sort({ createdAt: -1 });

        if (bookings.length > 0) {
          bookingToCancel = bookings[0];
          break;
        }
      }

      if (bookingToCancel) {
        bookingToCancel.status = 'cancelled';
        bookingToCancel.cancellationReason = 'Cancelled due to a higher priority booking.';
        await bookingToCancel.save();

        const cancelledUser = await User.findById(bookingToCancel.userId);
        if (cancelledUser) {
          let coinsToAdd = 0;
          switch (bookingToCancel.appointmentType) {
            case 'Free':
              coinsToAdd = 0;
              break;
            case 'Basic':
              coinsToAdd = 3;
              break;
            case 'Premium':
              coinsToAdd = 10;
              break;
            case 'Black Premium':
              coinsToAdd = 15;
              break;
            default:
              coinsToAdd = 0; // Default to 0 if type is unrecognized
          }

          cancelledUser.setkarCoins = (cancelledUser.setkarCoins || 0) + coinsToAdd;
          await cancelledUser.save();

          const notification = new Notification({
            userId: cancelledUser._id,
            title: 'Booking Cancelled',
            message: `Your booking with ${barber.name} has been cancelled due to a higher priority booking. ${coinsToAdd} Setkar Coins have been added to your account.`,
          });
          await notification.save();
        }
      } else {
        return res.status(400).json({ msg: 'This barber is fully booked with high priority appointments.' });
      }
    }

    // For public bookings, set as offline booking with customer info
    const newBooking = new Booking({
      userId: undefined, // No authenticated user
      barberId,
      date,
      time,
      services,
      totalPrice,
      appointmentType,
      isOfflineBooking: true, // Mark as offline/public booking
      customerName: customerInfo.name,
      customerPhone: customerInfo.phone,
      paymentStatus: 'pending', // Public bookings start as pending
      status: 'pending'
    });

    const booking = await newBooking.save();

    // Create a notification for the barber
    const barberForNotification = await User.findById(barberId);
    if (barberForNotification) {
      const bookingDate = new Date(date);
      const [hours, minutes] = time.split(':');
      bookingDate.setHours(hours);
      bookingDate.setMinutes(minutes);

      const formattedDate = bookingDate.toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Asia/Kolkata',
      });
      const formattedTime = bookingDate.toLocaleTimeString('en-IN', {
        hour: 'numeric',
        minute: 'numeric',
        hour12: true,
        timeZone: 'Asia/Kolkata',
      });

      const serviceNames = Array.isArray(services) ? services.map(service => service.name).join(', ') : 'a service';

      const notification = new Notification({
        userId: barberForNotification._id,
        title: 'New Public Booking',
        message: `You have a new public booking from ${customerInfo.name} (${customerInfo.phone}) for ${serviceNames} on ${formattedDate} at ${formattedTime}.`,
      });
      await notification.save();
    }

    res.json(booking);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: err.message });
  }
});

// @route   PUT api/booking/update-payment/:id
// @desc    Update booking payment status
// @access  Private
router.put('/update-payment/:id', auth, async (req, res) => {
  try {
    const { paymentStatus, paymentMethod, transactionId, paymentAmount } = req.body;
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ msg: 'Booking not found' });
    }

    // Update payment information
    if (paymentStatus) booking.paymentStatus = paymentStatus;
    if (paymentMethod) booking.paymentMethod = paymentMethod;
    if (transactionId) booking.transactionId = transactionId;
    if (paymentAmount) booking.paymentAmount = paymentAmount;

    await booking.save();

    res.json(booking);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: err.message });
  }
});

module.exports = router;
