const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Booking = require('../models/Booking');
const User = require('../models/User'); // Import User model
const Review = require('../models/Review'); // Import Review model
const moment = require('moment');

// @route   GET api/earnings
// @desc    Get earnings data
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const { filter } = req.query; // 'day', 'week', 'month'
    const barberId = req.user.id;

    // Handle request from home screen for today's and lifetime earnings
    if (!filter) {
      const todayStart = moment().startOf('day');
      const todayEnd = moment().endOf('day');
      const todayBookings = await Booking.find({
        barberId: barberId,
        status: 'completed',
        createdAt: { $gte: todayStart.toDate(), $lte: todayEnd.toDate() },
      });
      const todayEarnings = todayBookings.reduce((acc, booking) => acc + booking.totalPrice, 0);

      const lifetimeBookings = await Booking.find({
        barberId: barberId,
        status: 'completed',
      });
      const lifetimeEarnings = lifetimeBookings.reduce((acc, booking) => acc + booking.totalPrice, 0);

      return res.json({
        todayEarnings,
        lifetimeEarnings,
      });
    }

    // Existing logic for detailed earnings with filters
    let startDate;
    const endDate = moment().endOf('day');

    if (filter === 'day') {
      startDate = moment().startOf('day');
    } else if (filter === 'week') {
      startDate = moment().startOf('week');
    } else if (filter === 'month') {
      startDate = moment().startOf('month');
    } else {
      return res.status(400).json({ msg: 'Invalid filter' });
    }

    const query = {
      barberId: barberId,
      status: 'completed',
      date: { // Changed from createdAt to date
        $gte: startDate.toDate(),
        $lte: endDate.toDate(),
      },
    };
    console.log('Query:', JSON.stringify(query, null, 2));

    let bookings;
    try {
      bookings = await Booking.find(query).populate('userId', 'name'); // Populate userId to get customer name
      console.log('Bookings found:', bookings);
    } catch (err) {
      console.error('Database Error:', err);
      return res.status(500).send('Server Error');
    }

    const totalEarnings = bookings.reduce((acc, booking) => acc + booking.totalPrice, 0);
    const totalBookings = bookings.length;

    // Tier-wise earning breakdown
    const tierBreakdown = {
      'Black Premium': { count: 0, earnings: 0, percentage: 0 },
      'Premium': { count: 0, earnings: 0, percentage: 0 },
      'Basic': { count: 0, earnings: 0, percentage: 0 },
      'Free': { count: 0, earnings: 0, percentage: 0 },
    };

    bookings.forEach(booking => {
      // Ensure appointmentType exists and is one of the predefined tiers
      if (booking.appointmentType && tierBreakdown[booking.appointmentType]) {
        tierBreakdown[booking.appointmentType].count++;
        tierBreakdown[booking.appointmentType].earnings += booking.totalPrice;
      }
    });

    if (totalBookings > 0) {
      for (const tier in tierBreakdown) {
        tierBreakdown[tier].percentage = (tierBreakdown[tier].count / totalBookings) * 100;
      }
    }
    
    const uniqueCustomerIdentifiers = new Set();
    const customerBookingCounts = {};

    bookings.forEach(booking => {
      let identifier;
      if (booking.isOfflineBooking) {
        identifier = `offline-${booking.customerPhone}`; // Prefix to distinguish from actual user IDs
      } else if (booking.userId && booking.userId._id) {
        identifier = booking.userId._id.toString();
      } else {
        console.warn('Booking found without userId or customerPhone:', booking);
        return;
      }

      uniqueCustomerIdentifiers.add(identifier);
      customerBookingCounts[identifier] = (customerBookingCounts[identifier] || 0) + 1;
    });

    const customerIds = Array.from(uniqueCustomerIdentifiers);
    const totalCustomers = customerIds.length;

    // Fetch customer details with their latest review for this barber
    let customersServed = await Promise.all(customerIds.map(async (identifier) => {
      if (identifier.startsWith('offline-')) {
        const customerPhone = identifier.substring('offline-'.length);
        const sampleBooking = bookings.find(b => b.isOfflineBooking && b.customerPhone === customerPhone);
        const customerName = sampleBooking ? sampleBooking.customerName : 'Offline Customer';

        return {
          id: identifier,
          name: customerName,
          phone: customerPhone,
          isOffline: true,
          review: 'N/A (Offline Booking)',
          rating: 0,
          reviewCount: 0,
          averageRating: 0,
          bookingCount: customerBookingCounts[identifier] || 0,
        };
      } else {
        const customer = await User.findById(identifier, 'name');
        if (!customer) {
          return {
            id: identifier,
            name: 'Unknown User',
            isOffline: false,
            review: 'User not found.',
            rating: 0,
            reviewCount: 0,
            averageRating: 0,
            bookingCount: customerBookingCounts[identifier] || 0,
          };
        }

        const allReviews = await Review.find({
          barberId: barberId,
          userId: identifier,
        });

        const reviewCount = allReviews.length;
        const averageRating = reviewCount > 0
          ? (allReviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount).toFixed(1)
          : 0;

        const latestReview = await Review.findOne({
          barberId: barberId,
          userId: identifier,
        }).sort({ createdAt: -1 });

        return {
          id: customer._id,
          name: customer.name,
          isOffline: false,
          review: latestReview ? latestReview.text : 'No review yet.',
          rating: latestReview ? latestReview.rating : 0,
          reviewCount: reviewCount,
          averageRating: parseFloat(averageRating),
          bookingCount: customerBookingCounts[identifier] || 0,
        };
      }
    }));

    // Sort customers by booking count in descending order
    customersServed.sort((a, b) => b.bookingCount - a.bookingCount);

    // Growth calculation (example: compared to previous period)
    const prevStartDate = moment(startDate).subtract(1, `${filter}s`);
    const prevEndDate = moment(endDate).subtract(1, `${filter}s`);

    const prevBookings = await Booking.find({
      barberId: barberId,
      status: 'completed',
      createdAt: {
        $gte: prevStartDate.toDate(),
        $lte: prevEndDate.toDate(),
      },
    });

    const prevTotalEarnings = prevBookings.reduce((acc, booking) => acc + booking.totalPrice, 0);
    
    let growth = 0;
    if (prevTotalEarnings > 0) {
      growth = ((totalEarnings - prevTotalEarnings) / prevTotalEarnings) * 100;
    } else if (totalEarnings > 0) {
      growth = 100;
    }

    // Calculate monthly earnings for the chart
    let dailyEarnings, weeklyEarnings, monthlyEarnings;

    if (filter === 'day') {
      dailyEarnings = Array(24).fill(0);
      bookings.forEach(booking => {
        const hour = moment(booking.date).hour();
        dailyEarnings[hour] += booking.totalPrice;
      });
    } else if (filter === 'week') {
      weeklyEarnings = Array(7).fill(0);
      bookings.forEach(booking => {
        const dayOfWeek = moment(booking.date).day(); // Sunday is 0, Monday is 1, etc.
        weeklyEarnings[dayOfWeek] += booking.totalPrice;
      });
    } else { // month
      const daysInMonth = moment().daysInMonth();
      monthlyEarnings = Array(daysInMonth).fill(0);
      bookings.forEach(booking => {
        const dayOfMonth = moment(booking.date).date() - 1; // moment().date() is 1-based
        monthlyEarnings[dayOfMonth] += booking.totalPrice;
      });
    }

    // --- Earning Forecast Logic ---
    const startOfMonth = moment().startOf('month');
    const endOfMonth = moment().endOf('month');
    const daysInMonth = moment().daysInMonth();

    const monthBookings = await Booking.find({
      barberId: barberId,
      status: 'completed',
      date: {
        $gte: startOfMonth.toDate(),
        $lte: endOfMonth.toDate(),
      },
    });

    const totalMonthEarnings = monthBookings.reduce((acc, booking) => acc + booking.totalPrice, 0);
    const averageDailyEarnings = totalMonthEarnings / daysInMonth;

    const forecast7Days = averageDailyEarnings * 7;
    const forecast30Days = averageDailyEarnings * 30;
    // --- End Earning Forecast Logic ---

    res.json({
      totalEarnings,
      totalBookings,
      totalCustomers,
      tierBreakdown, // Add tier breakdown to the response
      growth: growth.toFixed(0),
      dailyEarnings,
      weeklyEarnings,
      monthlyEarnings,
      recentTransactions: bookings.map(booking => ({
        id: booking._id,
        description: booking.services.map(s => s.name).join(', '),
        amount: booking.totalPrice,
        date: booking.createdAt,
      })),
      customersServedList: customersServed, // Add the list of customers served
      forecast7Days, // Add 7-day forecast
      forecast30Days, // Add 30-day forecast
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   GET api/earnings/gst-summary
// @desc    Get GST invoice summary for tax purposes
// @access  Private
router.get('/gst-summary', auth, async (req, res) => {
  try {
    const barberId = req.user.id;

    // For a real GST summary, you'd need to consider a specific period (e.g., financial year, quarter)
    // For now, let's calculate based on lifetime earnings for simplicity, or a specified filter.
    // The frontend will likely call this with a filter.
    const { filter } = req.query; 

    let startDate;
    const endDate = moment().endOf('day');

    if (filter === 'day') {
      startDate = moment().startOf('day');
    } else if (filter === 'week') {
      startDate = moment().startOf('week');
    } else if (filter === 'month') {
      startDate = moment().startOf('month');
    } else if (filter === 'lifetime') { // New filter for lifetime GST summary
      startDate = moment(0); // Start of Unix epoch
    } else {
      return res.status(400).json({ msg: 'Invalid filter for GST summary' });
    }

    const bookings = await Booking.find({
      barberId: barberId,
      status: 'completed',
      date: {
        $gte: startDate.toDate(),
        $lte: endDate.toDate(),
      },
    });

    const totalEarnings = bookings.reduce((acc, booking) => acc + booking.totalPrice, 0);

    // Assuming a flat GST rate of 18% for services in India
    const gstRate = 0.18;
    const totalGSTCollected = totalEarnings * gstRate;
    const totalTaxableEarnings = totalEarnings - totalGSTCollected;

    // In a real scenario, you might also include:
    // - GSTIN of the barber
    // - HSN/SAC codes for services
    // - Breakdown of CGST/SGST/IGST
    // - Invoice numbers generated

    res.json({
      period: filter,
      totalEarnings: totalEarnings.toFixed(2),
      totalTaxableEarnings: totalTaxableEarnings.toFixed(2),
      gstRate: (gstRate * 100).toFixed(0) + '%',
      totalGSTCollected: totalGSTCollected.toFixed(2),
      // Placeholder for a real invoice generation link
      invoiceDownloadLink: 'https://example.com/generate-invoice?id=123', 
    });

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
