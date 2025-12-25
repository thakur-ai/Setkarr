const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const BarberCard = require('../models/BarberCard');
const Shop = require('../models/Shop');
const User = require('../models/User');
const Review = require('../models/Review');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Simple in-memory cache for barber card data (use Redis in production)
const barberCardCache = new Map();
const BARBER_CARD_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Ensure the uploads directory exists
const uploadsDir = path.join(__dirname, '../../barber-app/Uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Set up multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`);
  },
});

const upload = multer({ storage });

// @route   POST api/barber-card
// @desc    Create a new barber card
// @access  Private
router.post('/', auth, async (req, res) => {
  const { name, services, specialties, avgAppointmentTime, isAvailable } = req.body;

  try {
    // Check if user already has a barber card
    const existingCard = await BarberCard.findOne({ barberId: req.user.id });
    if (existingCard) {
      return res.status(400).json({ msg: 'You already have a barber card' });
    }

    // Check if user is owner or staff at a shop
    let shop = await Shop.findOne({ owner: req.user.id });
    if (!shop) {
      shop = await Shop.findOne({ staff: req.user.id });
    }
    // Temporarily allow creating without shop for testing
    // if (!shop) {
    //   return res.status(400).json({ msg: 'You must be associated with a shop to create a barber card' });
    // }

    // Calculate total appointment time from services if not provided
    let calculatedAvgTime = avgAppointmentTime;
    if (!calculatedAvgTime && services && services.length > 0) {
      const totalTime = services.reduce((sum, service) => sum + parseInt(service.time || 0), 0);
      calculatedAvgTime = `${totalTime} min`;
    } else if (!calculatedAvgTime) {
      calculatedAvgTime = '30 min';
    }

    const barberCard = new BarberCard({
      barberId: req.user.id,
      shopId: shop ? shop._id : null,
      name,
      services: services || [],
      specialties: specialties || [],
      avgAppointmentTime: calculatedAvgTime,
      isAvailable: isAvailable !== undefined ? isAvailable : true,
    });

    await barberCard.save();
    res.json(barberCard);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   GET api/barber-card/my-card
// @desc    Get current user's barber card
// @access  Private
router.get('/my-card', auth, async (req, res) => {
  try {
    const barberCard = await BarberCard.findOne({ barberId: req.user.id });
    if (!barberCard) {
      return res.status(404).json({ msg: 'Barber card not found' });
    }
    res.json(barberCard);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   PUT api/barber-card
// @desc    Update user's barber card
// @access  Private
router.put('/', auth, async (req, res) => {
  const { name, services, specialties, avgAppointmentTime, isAvailable, image } = req.body;

  try {
    let barberCard = await BarberCard.findOne({ barberId: req.user.id });

    if (!barberCard) {
      return res.status(404).json({ msg: 'Barber card not found' });
    }

    // Update fields
    if (name) barberCard.name = name;
    if (services) barberCard.services = services;
    if (specialties) barberCard.specialties = specialties;
    if (isAvailable !== undefined) barberCard.isAvailable = isAvailable;
    if (image) barberCard.image = image;

    // Recalculate total appointment time if services changed or if avgAppointmentTime is provided
    if (services || avgAppointmentTime) {
      if (avgAppointmentTime) {
        barberCard.avgAppointmentTime = avgAppointmentTime;
      } else if (services && services.length > 0) {
        const totalTime = services.reduce((sum, service) => sum + parseInt(service.time || 0), 0);
        barberCard.avgAppointmentTime = `${totalTime} min`;
      }
    }

    await barberCard.save();
    res.json(barberCard);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   GET api/barber-card/shop/:shopId
// @desc    Get all barber cards for a shop
// @access  Public
router.get('/shop/:shopId', async (req, res) => {
  try {
    const barberCards = await BarberCard.find({ shopId: req.params.shopId })
      .populate('barberId', 'profilePicture rating reviews')
      .sort({ createdAt: -1 });

    res.json(barberCards);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   GET api/barber-card/all
// @desc    Get all barber cards (HEAVILY OPTIMIZED - NO CACHING for real-time availability)
// @access  Public
router.get('/all', async (req, res) => {
  try {
    const { category, shopId, page, limit } = req.query;
    let filter = {};

    if (shopId) {
      filter.shopId = shopId;
    } else if (category) {
      const shops = await Shop.find({ category: { $in: category.split(',') } });
      const shopIds = shops.map(shop => shop._id);
      filter.shopId = { $in: shopIds };
    }

    // 1. Pagination Setup
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 0;
    const skip = limitNum > 0 ? (pageNum - 1) * limitNum : 0;

    // 2. Fetch Cards with Pagination
    let query = BarberCard.find(filter)
      .populate('barberId', 'profilePicture rating reviews maxAppointmentsPerDay todaysBookings isAvailable')
      .populate('shopId', 'name address category tag isAvailable')
      .sort({ createdAt: -1 });

    if (limitNum > 0) {
      query = query.skip(skip).limit(limitNum);
    }

    const barberCards = await query;

    // 3. Batch Fetch Reviews (Solving N+1 Problem)
    const barberIds = barberCards.map(card => card.barberId._id);

    const reviewsAggregation = await Review.aggregate([
      { $match: { barberId: { $in: barberIds } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$barberId",
          reviews: { $push: "$$ROOT" },
          count: { $sum: 1 },
          avgRating: { $avg: "$rating" }
        }
      },
      {
        $project: {
          reviews: { $slice: ["$reviews", 3] },
          count: 1,
          avgRating: 1
        }
      }
    ]);

    await Review.populate(reviewsAggregation, { path: 'reviews.userId', select: 'name' });

    const reviewsMap = new Map();
    reviewsAggregation.forEach(item => {
      reviewsMap.set(item._id.toString(), item);
    });

    // 4. Construct Final Data
    const barberCardsWithBookings = barberCards.map((card) => {
      const reviewData = reviewsMap.get(card.barberId._id.toString());

      const reviews = reviewData ? reviewData.reviews : [];
      const reviewCount = reviewData ? reviewData.count : 0;
      const averageRating = reviewData ? reviewData.avgRating : (card.rating || card.barberId.rating || 0);

      return {
        id: card._id,
        barberId: card.barberId._id,
        name: card.name,
        address: card.shopId ? card.shopId.address : 'No address',
        image: {
          uri: card.image || card.barberId.profilePicture || 'https://via.placeholder.com/150',
        },
        rating: averageRating,
        reviewCount: reviewCount,
        services: card.services || [],
        category: card.shopId ? card.shopId.category : 'General',
        tag: card.specialties?.[0] || (card.shopId ? card.shopId.tag : 'Barber'),
        avgAppointmentTime: card.avgAppointmentTime,
        totalServices: card.services?.length || 0,
        isAvailable: card.barberId.isAvailable,
        todaysBookings: card.barberId.todaysBookings || 0,
        shopName: card.shopId ? card.shopId.name : 'Independent',
        listingTier: 'Basic',
        reviews,
      };
    });

    res.json(barberCardsWithBookings);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   PUT api/barber-card/increment-click/:cardId
// @desc    Increment click count for a barber card
// @access  Public
router.put('/increment-click/:cardId', async (req, res) => {
  try {
    const barberCard = await BarberCard.findById(req.params.cardId);

    if (!barberCard) {
      return res.status(404).json({ msg: 'Barber card not found' });
    }

    barberCard.clickCount = (barberCard.clickCount || 0) + 1;
    await barberCard.save();

    res.json({ success: true, clickCount: barberCard.clickCount });
  } catch (err) {
    console.error('Error incrementing click count:', err);
    res.status(500).json({ msg: 'Server Error', error: err.message });
  }
});

// @route   POST api/barber-card/upload-image
// @desc    Upload barber card image
// @access  Private
router.post('/upload-image', auth, upload.single('barberCardImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ msg: 'No file uploaded' });
    }

    // Construct the URL for the uploaded image
    const imageUrl = `/Uploads/${req.file.filename}`;

    res.json({ imageUrl });
  } catch (err) {
    console.error('Error uploading image:', err);
    res.status(500).json({ msg: 'Server Error', error: err.message });
  }
});

module.exports = router;
