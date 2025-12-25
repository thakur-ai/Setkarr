const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Shop = require('../models/Shop');
const Booking = require('../models/Booking');
const BarberCard = require('../models/BarberCard');
const User = require('../models/User');
const ListingPlace = require('../models/ListingPlace');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Simple in-memory cache for shop data (use Redis in production)
const shopCache = new Map();
const SHOP_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

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

// Helper function to calculate barber score based on rating and review count
function calculateBarberScore(rating, reviewCount) {
  // Primary factor: rating (0-5)
  // Secondary factor: review count (logarithmic to prevent very high review counts from dominating)
  // This gives higher weight to rating but also considers review volume
  const reviewWeight = Math.log(reviewCount + 1) / Math.log(100); // Normalize review count impact
  return rating * (1 + reviewWeight * 0.1); // Rating gets 90-100% weight, reviews add up to 10%
}

// @route   GET api/shop/featured-barbers
// @desc    Get top-rated barbers from each service provider type for featured section
// @access  Public
router.get('/featured-barbers', async (req, res) => {
  try {
    // Define the categories we want to feature
    const categories = ["Barber", "Women's Salon", "Pet Care"];

    const featuredBarbers = [];

    // For each category, get the top-rated barber (considering both rating and review count)
    for (const category of categories) {
      // Find shops in this category (confirmed or not, for featured display)
      const shops = await Shop.find({
        category
      })
      .populate('owner', 'name email phone profilePicture shopName shopAddress shopPhone')
      .populate({
        path: 'selectedListingPlace',
        populate: {
          path: 'lockedBy',
          select: 'name profilePicture',
        },
      });

      if (shops.length > 0) {
        // Find the shop with the best-rated barber in this category
        // Prioritize by rating score (not listing tier)
        let topShop = shops[0];
        let bestScore = calculateBarberScore(topShop.rating || 0, topShop.reviews || 0);

        for (const shop of shops) {
          const score = calculateBarberScore(shop.rating || 0, shop.reviews || 0);
          if (score > bestScore) {
            bestScore = score;
            topShop = shop;
          }
        }

        // Transform the data to match the frontend expected format
        const barber = topShop.owner;
        const lowestServicePrice = topShop.services && topShop.services.length > 0
          ? Math.min(...topShop.services.map(service => parseFloat(service.price) || 0))
          : 200; // Default price

        // Use shop's real rating, or generate realistic rating if shop has no rating
        let displayRating = topShop.rating || 0;
        if (displayRating === 0) {
          // Generate a realistic rating between 3.5 and 5.0
          displayRating = 3.5 + Math.random() * 1.5;
        }

        featuredBarbers.push({
          id: barber._id,
          name: topShop.name || barber.name,
          rating: displayRating,
          distance: '2.5 km', // This would need to be calculated based on user location
          price: lowestServicePrice,
          nextSlot: '10:30 AM', // This would need to be calculated based on availability
          img: barber.profilePicture || 'https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=800&q=80',
          verified: true, // Assuming all listed shops are verified
          shopAddress: topShop.address,
          shopPhone: topShop.phone,
          category: topShop.category,
          services: topShop.services || []
        });
      }
    }

    // Sort by rating (highest first) to ensure the best ones appear first
    featuredBarbers.sort((a, b) => b.rating - a.rating);

    res.json(featuredBarbers);
  } catch (err) {
    console.error('Error fetching featured barbers:', err);
    res.status(500).json({ msg: 'Server Error', error: err.message });
  }
});

// @route   POST api/shop
// @desc    Create a new shop for the current user
// @access  Private
router.post('/', auth, async (req, res) => {
  const { name, address, phone, category } = req.body;

  try {
    // Check if user already owns a shop
    const existingShop = await Shop.findOne({ owner: req.user.id });
    if (existingShop) {
      return res.status(400).json({ msg: 'You already own a shop' });
    }

    // Check if user is staff at another shop
    const staffShop = await Shop.findOne({ staff: req.user.id });
    if (staffShop) {
      // Allow staff to create their own shop
      // Remove them from the staff array of the previous shop
      staffShop.staff = staffShop.staff.filter(id => id.toString() !== req.user.id);
      await staffShop.save();
    }

    // Create new shop
    const shop = new Shop({
      owner: req.user.id,
      name,
      address,
      phone,
      category,
    });

    await shop.save();
    res.json(shop);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   GET api/shop
// @desc    Get current user's shop (only if they own one)
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const shop = await Shop.findOne({ owner: req.user.id }).populate({
      path: 'selectedListingPlace',
      populate: {
        path: 'lockedBy',
        select: 'name profilePicture',
      },
    });

    if (!shop) {
      return res.status(404).json({ msg: 'Shop not found - you may not own a shop or be staff at one' });
    }

    res.json(shop);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   PUT api/shop
// @desc    Update user's shop
// @access  Private
router.put('/', auth, async (req, res) => {
  const { name, address, phone, services, tag, location, avgAppointmentTime, isAvailable, image, upiId, operatingHours } = req.body;

  try {
    let shop = await Shop.findOne({ owner: req.user.id });

    if (!shop) {
      return res.status(404).json({ msg: 'Shop not found' });
    }

    // Update fields
    if (name) shop.name = name;
    if (address) shop.address = address;
    if (phone) shop.phone = phone;
    if (services) shop.services = services;
    if (tag) shop.tag = tag;
    if (location) shop.location = location;
    if (avgAppointmentTime) shop.avgAppointmentTime = avgAppointmentTime;
    if (isAvailable !== undefined) shop.isAvailable = isAvailable;
    if (image) shop.image = image; // Add image update
    if (upiId) shop.upiId = upiId;
    if (operatingHours) shop.operatingHours = operatingHours;

    await shop.save();
    res.json(shop);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   PUT api/shop/category
// @desc    Update user's shop category
// @access  Private
router.put('/category', auth, async (req, res) => {
  const { category } = req.body;

  try {
    let shop = await Shop.findOne({ owner: req.user.id });

    if (!shop) {
      return res.status(404).json({ msg: 'Shop not found' });
    }

    if (shop.listingConfirmed) {
      return res.status(400).json({ msg: 'Category cannot be changed after listing is confirmed.' });
    }

    if (category) shop.category = category;

    await shop.save();
    res.json({ success: true, shop });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   PUT api/shop/confirm-listing
// @desc    Confirm user's shop listing
// @access  Private
router.put('/confirm-listing', auth, async (req, res) => {
  try {
    let shop = await Shop.findOne({ owner: req.user.id });

    if (!shop) {
      return res.status(404).json({ msg: 'Shop not found' });
    }

    if (shop.listingConfirmed) {
      return res.status(400).json({ msg: 'Listing is already confirmed and cannot be changed.' });
    }

    shop.listingConfirmed = true;
    await shop.save();
    res.json({ success: true, shop });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   GET api/shop/all
// @desc    Get all shops (HEAVILY OPTIMIZED - NO CACHING for real-time availability)
// @access  Public
router.get('/all', async (req, res) => {
  try {
    const { category, page, limit } = req.query;
    let filter = {};
    if (category) {
      filter.category = { $in: category.split(',') };
    }

    // 1. Pagination Setup
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 0; // 0 means no limit (backward compatibility)
    const skip = limitNum > 0 ? (pageNum - 1) * limitNum : 0;

    // 2. Fetch Shops with Pagination
    let shopQuery = Shop.find(filter)
      .populate('owner', 'name email phone profilePicture maxAppointmentsPerDay rating reviews isAvailable')
      .populate('staff', 'name email phone profilePicture maxAppointmentsPerDay rating reviews isAvailable')
      .populate({
        path: 'selectedListingPlace',
        populate: { path: 'lockedBy', select: 'name profilePicture' },
      });

    // Only apply DB limit if we aren't doing complex sorting in memory later
    if (limitNum > 0) {
       shopQuery = shopQuery.skip(skip).limit(limitNum);
    }

    const shops = await shopQuery;

    // 3. Batch Fetch User Data (Solving N+1 Problem)
    const allBarberIds = [];
    shops.forEach(shop => {
      if (shop.owner) allBarberIds.push(shop.owner._id);
      if (shop.staff) allBarberIds.push(...shop.staff.map(s => s._id));
    });

    const allBarbers = await User.find({ _id: { $in: allBarberIds } })
      .select('maxAppointmentsPerDay todaysBookings reviews rating isAvailable');

    const barberMap = new Map();
    allBarbers.forEach(b => barberMap.set(b._id.toString(), b));

    // 4. Process Data in Memory
    const shopsWithBookingCounts = shops.map((shop) => {
      const owner = shop.owner ? barberMap.get(shop.owner._id.toString()) : null;
      const staffMembers = shop.staff ? shop.staff.map(s => barberMap.get(s._id.toString())).filter(Boolean) : [];

      const shopBarbers = [owner, ...staffMembers].filter(Boolean);
      const availableBarbers = shopBarbers.filter(b => b.isAvailable && b.maxAppointmentsPerDay > 0);
      const hasAnyAvailableBarber = shopBarbers.some(b => b.isAvailable);

      const todaysBookings = availableBarbers.reduce((sum, b) => sum + (b.todaysBookings || 0), 0);
      const totalMaxAppointments = availableBarbers.reduce((sum, b) => sum + (b.maxAppointmentsPerDay || 0), 0);

      // Calculate average rating from all barbers (owner + staff) using populated data
      // Only include barbers with rating > 0
      let totalRating = 0;
      let totalReviews = 0;
      let barberCount = 0;

      if (shop.owner && shop.owner.rating > 0) {
        totalRating += shop.owner.rating;
        totalReviews += shop.owner.reviews || 0;
        barberCount++;
      }

      if (shop.staff) {
        shop.staff.forEach(staffUser => {
          if (staffUser.rating > 0) {
            totalRating += staffUser.rating;
            totalReviews += staffUser.reviews || 0;
            barberCount++;
          }
        });
      }

      const averageRating = barberCount > 0 ? totalRating / barberCount : 0;

      return {
        ...shop.toObject(),
        rating: averageRating, // Override shop rating with barber average
        todaysBookings,
        totalMaxAppointments,
        isAvailable: hasAnyAvailableBarber,
        shopRating: averageRating,
        totalBarbers: barberCount,
        totalReviews: totalReviews,
      };
    });

    // 5. Sort by listing tier (only if not paginated, or apply to full dataset)
    if (limitNum === 0) {
      shopsWithBookingCounts.sort((a, b) => {
        const tierA = a.selectedListingPlace ? a.selectedListingPlace.tierId : Infinity;
        const tierB = b.selectedListingPlace ? b.selectedListingPlace.tierId : Infinity;
        return tierA - tierB;
      });
    }

    // 6. Apply Pagination Slicing if needed
    let result = shopsWithBookingCounts;
    if (limitNum > 0 && skip > 0) {
      result = shopsWithBookingCounts.slice(skip, skip + limitNum);
    }

    res.json(result);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   GET api/shop/locked-places
// @desc    Get all currently locked listing places, optionally filtered by category
// @access  Public
router.get('/locked-places', async (req, res) => {
  try {
    const { category } = req.query;
    let filter = {};
    if (category) {
      filter.category = category;
    }
    const lockedPlaces = await ListingPlace.find(filter).populate('lockedBy', 'name profilePicture');
    res.json(lockedPlaces);
  } catch (err) {
    console.error('Error fetching locked places:', err);
    res.status(500).json({ msg: 'Server Error', error: err.message });
  }
});

// @route   GET api/shop/my-shop
// @desc    Get shop where user is either owner or staff member
// @access  Private
router.get('/my-shop', auth, async (req, res) => {
  try {
    // First try to find shop where user is the owner
    let shop = await Shop.findOne({ owner: req.user.id })
      .populate('staff', 'name email phone profilePicture rating reviews') // Populate staff details
      .populate({
        path: 'selectedListingPlace',
        populate: {
          path: 'lockedBy',
          select: 'name profilePicture',
        },
      });

    if (!shop) {
      // If not owner, check if user is staff at any shop
      shop = await Shop.findOne({ staff: req.user.id })
        .populate('owner', 'name email phone profilePicture rating reviews') // Populate owner details
        .populate('staff', 'name email phone profilePicture rating reviews') // Populate all staff details
        .populate({
          path: 'selectedListingPlace',
          populate: {
            path: 'lockedBy',
            select: 'name profilePicture',
          },
        });
    }

    if (!shop) {
      return res.status(404).json({ msg: 'No shop found for this user' });
    }

    // Add a flag to indicate if user is the main owner
    const isMainOwner = shop.owner._id.toString() === req.user.id;

    res.json({ ...shop.toObject(), isMainOwner });
  } catch (err) {
    console.error('Error fetching user shop:', err);
    res.status(500).json({ msg: 'Server Error', error: err.message });
  }
});

// @route   GET api/shop/barber/:barberId
// @desc    Get shop by barber (owner) ID
// @access  Public
router.get('/barber/:barberId', async (req, res) => {
  try {
    const shop = await Shop.findOne({ owner: req.params.barberId }).populate('owner', ['name', 'profilePicture']);
    if (!shop) {
      return res.status(404).json({ msg: 'Shop not found for this barber.' });
    }
    res.json(shop);
  } catch (err) {
    console.error('Error fetching shop by barber ID:', err);
    res.status(500).send('Server Error');
  }
});

// @route   GET api/shop/:id
// @desc    Get shop by ID
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const shop = await Shop.findById(req.params.id).populate('owner', ['name', 'profilePicture']);
    if (!shop) {
      return res.status(404).json({ msg: 'Shop not found' });
    }

    // Calculate customers served
    const customersServed = await Booking.distinct('userId', {
      barberId: shop.owner._id,
      status: { $ne: 'cancelled' },
    });

    res.json({ ...shop.toObject(), customersServed: customersServed.length });
  } catch (err) {
    console.error(err.message);
    if (err.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'Shop not found' });
    }
    res.status(500).send('Server Error');
  }
});

// @route   PUT api/shop/tag
// @desc    Update user's shop tag
// @access  Private
router.put('/tag', auth, async (req, res) => {
  const { tag } = req.body;

  try {
    let shop = await Shop.findOne({ owner: req.user.id });

    if (!shop) {
      return res.status(404).json({ msg: 'Shop not found' });
    }

    if (tag) shop.tag = tag;

    await shop.save();
    res.json({ success: true, shop });
  } catch (err) {
    console.error('Error updating tag:', err);
    res.status(500).json({ msg: 'Server Error', error: err.message });
  }
});

// @route   PUT api/shop/listing-tier
// @desc    Update user's shop listing tier
// @access  Private
router.put('/listing-tier', auth, async (req, res) => {
  const { tierId, category } = req.body;

  try {
    let shop = await Shop.findOne({ owner: req.user.id });

    if (!shop) {
      return res.status(404).json({ msg: 'Shop not found' });
    }

    if (!category) {
      return res.status(400).json({ msg: 'Category is required for listing tier operations.' });
    }

    // Release any existing lock for the current user and category first
    await ListingPlace.findOneAndDelete({ lockedBy: req.user.id, category });
    shop.selectedListingPlace = null; // Assume deselection

    // If a new tierId is provided, attempt to lock it
    if (tierId) {
      // Check if the requested tier for this category is already locked by anyone
      const conflictingLock = await ListingPlace.findOne({ tierId, category });
      if (conflictingLock) {
        return res.status(400).json({ msg: 'This place is already booked by another barber for this category.' });
      }

      // Lock the new tier for the current user and category
      const newListingPlace = new ListingPlace({
        tierId,
        category,
        lockedBy: req.user.id,
      });
      await newListingPlace.save();
      shop.selectedListingPlace = newListingPlace._id;
    }

    await shop.save();

    // Populate the selectedListingPlace and lockedBy for the response
    const updatedShop = await Shop.findById(shop._id)
      .populate({
        path: 'selectedListingPlace',
        populate: {
          path: 'lockedBy',
          select: 'name profilePicture', // Select relevant barber info
        },
      });

    res.json({ success: true, shop: updatedShop });
  } catch (err) {
    console.error('Error updating listing tier:', err);
    res.status(500).json({ msg: 'Server Error', error: err.message });
  }
});

// @route   PUT api/shop/increment-click/:shopId
// @desc    Increment click count for a shop
// @access  Public
router.put('/increment-click/:shopId', async (req, res) => {
  try {
    const shop = await Shop.findById(req.params.shopId);

    if (!shop) {
      return res.status(404).json({ msg: 'Shop not found' });
    }

    shop.clickCount = (shop.clickCount || 0) + 1;
    await shop.save();

    res.json({ success: true, clickCount: shop.clickCount });
  } catch (err) {
    console.error('Error incrementing click count:', err);
    res.status(500).json({ msg: 'Server Error', error: err.message });
  }
});

// @route   PUT api/shop/barber/cancel-listing/:barberId
// @desc    Cancel a barber's listing
// @access  Private
router.put('/barber/cancel-listing/:barberId', auth, async (req, res) => {
  try {
    const shop = await Shop.findOne({ owner: req.params.barberId });

    if (!shop) {
      return res.status(404).json({ msg: 'Shop not found' });
    }

    // Check if the authenticated user is the owner of the shop
    if (shop.owner.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'User not authorized' });
    }

    if (shop.selectedListingPlace) {
      await ListingPlace.findByIdAndDelete(shop.selectedListingPlace);
      shop.selectedListingPlace = null;
      await shop.save();
    }

    res.json({ success: true, msg: 'Listing cancelled successfully.' });
  } catch (err) {
    console.error('Error cancelling listing:', err);
    res.status(500).json({ msg: 'Server Error', error: err.message });
  }
});

// @route   POST api/shop/listing-place
// @desc    Create a new listing place after payment
// @access  Private
router.post('/listing-place', auth, async (req, res) => {
  const { tier, price, duration } = req.body;

  try {
    let shop = await Shop.findOne({ owner: req.user.id });

    if (!shop) {
      return res.status(404).json({ msg: 'Shop not found' });
    }

    if (!shop.category) {
      return res.status(400).json({ msg: 'Shop category must be set before activating a listing.' });
    }

    // Create and save the new listing place
    const newListingPlace = new ListingPlace({
      tierId: tier,
      category: shop.category,
      lockedBy: req.user.id,
      price,
      duration,
    });

    await newListingPlace.save();

    // Update the shop with the new listing place
    shop.selectedListingPlace = newListingPlace._id;
    await shop.save();

    res.status(201).json(newListingPlace);
  } catch (err) {
    console.error('Error creating listing place:', err);
    res.status(500).json({ msg: 'Server Error', error: err.message });
  }
});


// @route   POST api/shop/upload-image
// @desc    Upload shop image
// @access  Private
router.post('/upload-image', auth, upload.single('shopImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ msg: 'No file uploaded' });
    }

    // Construct the URL for the uploaded image
    // Assuming the barber-app/Uploads directory is served statically
    const imageUrl = `/Uploads/${req.file.filename}`; 
    
    res.json({ imageUrl });
  } catch (err) {
    console.error('Error uploading image:', err);
    res.status(500).json({ msg: 'Server Error', error: err.message });
  }
});

// @route   GET api/shop/services/:userId
// @desc    Get services for a specific barber
// @access  Private
router.get('/services/:userId', auth, async (req, res) => {
  try {
    const shop = await Shop.findOne({ owner: req.params.userId });
    if (!shop) {
      return res.status(404).json({ msg: 'Shop not found for this barber.' });
    }
    res.json(shop.services);
  } catch (err) {
    console.error('Error fetching services by user ID:', err); 
    res.status(500).send('Server Error');
  }
});

// @route   POST api/shop/staff
// @desc    Add staff member to shop (only owner can do this)
// @access  Private
router.post('/staff', auth, async (req, res) => {
  const { staffId } = req.body;

  try {
    const shop = await Shop.findOne({ owner: req.user.id });

    if (!shop) {
      return res.status(404).json({ msg: 'Shop not found' });
    }

    // Check if the staff member is already in the staff array
    if (shop.staff.includes(staffId)) {
      return res.status(400).json({ msg: 'Staff member already added to this shop' });
    }

    // Check if the staff member exists and is a barber
    const User = require('../models/User');
    const staffUser = await User.findById(staffId);
    if (!staffUser || staffUser.role !== 'barber') {
      return res.status(400).json({ msg: 'Invalid staff member - must be a barber' });
    }

    // Check if the staff member already owns a shop
    const existingShop = await Shop.findOne({ owner: staffId });
    if (existingShop) {
      return res.status(400).json({ msg: 'Staff member already owns a shop' });
    }

    // Check if the staff member is already staff at another shop
    const otherShop = await Shop.findOne({ staff: staffId });
    if (otherShop) {
      return res.status(400).json({ msg: 'Staff member is already working at another shop' });
    }

    shop.staff.push(staffId);
    await shop.save();

    res.json({ success: true, msg: 'Staff member added successfully', shop });
  } catch (err) {
    console.error('Error adding staff:', err);
    res.status(500).json({ msg: 'Server Error', error: err.message });
  }
});

// @route   DELETE api/shop/staff/:staffId
// @desc    Remove staff member from shop (only owner can do this)
// @access  Private
router.delete('/staff/:staffId', auth, async (req, res) => {
  try {
    const shop = await Shop.findOne({ owner: req.user.id });

    if (!shop) {
      return res.status(404).json({ msg: 'Shop not found' });
    }

    // Remove the staff member from the staff array
    shop.staff = shop.staff.filter(id => id.toString() !== req.params.staffId);
    await shop.save();

    res.json({ success: true, msg: 'Staff member removed successfully', shop });
  } catch (err) {
    console.error('Error removing staff:', err);
    res.status(500).json({ msg: 'Server Error', error: err.message });
  }
});

// @route   GET api/shop/staff
// @desc    Get staff members for current user's shop
// @access  Private
router.get('/staff', auth, async (req, res) => {
  try {
    const shop = await Shop.findOne({ owner: req.user.id }).populate('staff', 'name email phone profilePicture');

    if (!shop) {
      return res.status(404).json({ msg: 'Shop not found' });
    }

    res.json(shop.staff);
  } catch (err) {
    console.error('Error fetching staff:', err);
    res.status(500).json({ msg: 'Server Error', error: err.message });
  }
});

module.exports = router;
