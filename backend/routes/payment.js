const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const router = express.Router();
const mongoose = require('mongoose'); // Add mongoose import
const Booking = require('../models/Booking');
const User = require('../models/User');
const Notification = require('../models/Notification');
const auth = require('../middleware/auth');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Nodemailer transporter setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

router.post('/order', async (req, res) => {
  try {
    const { amount, currency, receipt } = req.body;
    const options = {
      amount: amount * 100, // amount in smallest currency unit (paise)
      currency,
      receipt,
    };
    const order = await razorpay.orders.create(options);
    res.json(order);
  } catch (error) {
    console.error('Error creating Razorpay order:', error);
    res.status(500).send('Error creating order');
  }
});

router.post('/verify', auth, async (req, res) => {
  try {
    const { order_id, payment_id, signature, bookingId } = req.body;
    const body = order_id + '|' + payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expectedSignature === signature) {
      const booking = await Booking.findById(bookingId);
      if (!booking) {
        return res.status(404).json({ msg: 'Booking not found' });
      }

    const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
    booking.paymentStatus = 'completed';
    booking.otp = otp;
    // If the booking was already accepted (status is 'pending' after barber acceptance),
    // and now payment is completed, change status to 'confirmed'.
    if (booking.status === 'pending') {
      booking.status = 'confirmed';
    }
    await booking.save();

    // Send notification to barber
      const barber = await User.findById(booking.barberId);
      if (barber) {
        const newNotification = new Notification({
          userId: barber._id,
          title: 'Payment Received',
          message: `Payment of ₹${booking.totalPrice} received from ${req.user.name} for booking on ${new Date(booking.date).toLocaleDateString()}.`,
        });
        await newNotification.save();
      }

      res.json({ status: 'success', message: 'Payment verified and booking updated' });
    } else {
      res.status(400).json({ status: 'failure', message: 'Payment verification failed' });
    }
  } catch (error) {
    console.error('Error verifying Razorpay payment:', error);
    res.status(500).send('Error verifying payment');
  }
});

// @route   POST api/payment/dummy-payment
// @desc    Simulate a successful payment for testing
// @access  Private
router.post('/dummy-payment', auth, async (req, res) => {
  try {
    const { bookingId } = req.body;
    const booking = await Booking.findById(bookingId);

    if (!booking) {
      return res.status(404).json({ msg: 'Booking not found' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
    booking.paymentStatus = 'completed';
    booking.otp = otp;
    // If the booking was already accepted (status is 'pending' after barber acceptance),
    // and now payment is completed, change status to 'confirmed'.
    if (booking.status === 'pending') {
      booking.status = 'confirmed';
    }
    await booking.save();

    // Send notification to barber
    const barber = await User.findById(booking.barberId);
    if (barber) {
      const newNotification = new Notification({
        userId: barber._id,
        title: 'Payment Received',
        message: `Payment of ₹${booking.totalPrice} received from ${req.user.name} for booking on ${new Date(booking.date).toLocaleDateString()}.`,
      });
      await newNotification.save();
    }

    res.json({ status: 'success', message: 'Dummy payment successful and booking updated', otp });
  } catch (error) {
    console.error('Error processing dummy payment:', error);
    res.status(500).send('Error processing dummy payment');
  }
});

// @route   POST api/payment/book-without-payment
// @desc    Create a booking without payment
// @access  Private
router.post('/book-without-payment', auth, async (req, res) => {
  try {
    console.log('Booking request body:', req.body);
    const { barberId, services, date, time, totalPrice, otp } = req.body; // Include otp in destructuring
    console.log('Booking with barberId:', barberId);

    // Concurrency check
    const existingBooking = await Booking.findOne({ barberId, date, time });
    if (existingBooking) {
      return res.status(409).json({ msg: 'This time slot is no longer available. Please choose another time.' });
    }

    const newBooking = new Booking({
      userId: req.user.id,
      barberId: barberId,
      services,
      date,
      time,
      totalPrice,
      otp, // Save the OTP
      status: 'pending',
    });

    await newBooking.save();

    // Send notification to barber
    const barber = await User.findById(barberId);
    if (barber) {
      const serviceNames = services.map(service => service.name).join(', ');
      const formattedDate = new Date(date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      const [timePart, ampm] = time.split(' ');
      let [hours, minutes, seconds] = timePart.split(':');
      if (ampm === 'pm' && hours !== '12') {
        hours = parseInt(hours, 10) + 12;
      }
      if (ampm === 'am' && hours === '12') {
        hours = '00';
      }
      const formattedTime = new Date(`${date.slice(0, 10)}T${hours}:${minutes}:${seconds}`).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: 'numeric',
        hour12: true,
      });

      const newNotification = new Notification({
        userId: barber._id,
        title: 'New Booking',
        message: `You have a new booking from ${req.user.name} for ${serviceNames} on ${formattedDate}.`,
      });
      await newNotification.save();
    }

    res.json({ status: 'success', message: 'Booking created successfully' });
  } catch (error) {
    console.error('Error creating booking without payment:', error);
    res.status(500).json({ msg: 'Error creating booking' });
  }
});

router.post('/send-otp', async (req, res) => {
  console.log('Received request to send OTP');
  console.log('GMAIL_USER:', process.env.GMAIL_USER);
  console.log('GMAIL_PASS:', process.env.GMAIL_PASS ? 'Loaded' : 'Not Loaded');

  try {
    const { email, otp } = req.body;
    console.log(`Sending OTP ${otp} to ${email}`);

    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: email,
      subject: 'Your Booking OTP',
      text: `Your OTP for booking confirmation is: ${otp}`,
    };

    await transporter.sendMail(mailOptions);
    console.log('OTP email sent successfully');
    res.json({ status: 'success', message: 'OTP sent successfully' });
  } catch (error) {
    console.error('Error sending OTP email:', error);
    res.status(500).send('Error sending OTP email');
  }
});

module.exports = router;
