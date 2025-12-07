const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Shop = require('../models/Shop');
const Booking = require('../models/Booking');
const ListingPlace = require('../models/ListingPlace');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

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

// @route   GET api/shop
// @desc    Get or create current user's shop
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    let shop = await Shop.findOne({ owner: req.user.id }).populate({
      path: 'selectedListingPlace',
      populate: {
        path: 'lockedBy',
        select: 'name profilePicture',
      },
    });

    if (!shop) {
      // If no shop exists, create one for the barber
      shop = new Shop({
        owner: req.user.id,
        name: 'My Shop', // Default name
        address: 'Not set',
        phone: 'Not set',
      });
      await shop.save();
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
  const { name, address, phone, services, tag, location, avgAppointmentTime, isAvailable, image, upiId } = req.body;

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
// @desc    Get all shops
// @access  Public
router.get('/all', async (req, res) => {
  try {
    const { category } = req.query;
    let filter = {};
    if (category) {
      // Allow multiple categories to be passed as a comma-separated string
      filter.category = { $in: category.split(',') };
    }

    const shops = await Shop.find(filter)
      .populate('owner', 'name profilePicture maxAppointmentsPerDay')
      .populate({
        path: 'selectedListingPlace',
        populate: {
          path: 'lockedBy',
          select: 'name profilePicture',
        },
      });
    
    const shopsWithBookingCounts = await Promise.all(shops.map(async (shop) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const todaysBookings = await Booking.countDocuments({
        barberId: shop.owner._id,
        date: {
          $gte: today,
          $lt: tomorrow,
        },
        status: { $ne: 'cancelled' },
      });

      return {
        ...shop.toObject(),
        todaysBookings,
      };
    }));

    // Sort by listing tier
    shopsWithBookingCounts.sort((a, b) => {
      const tierA = a.selectedListingPlace ? a.selectedListingPlace.tierId : Infinity;
      const tierB = b.selectedListingPlace ? b.selectedListingPlace.tierId : Infinity;
      return tierA - tierB;
    });

    res.json(shopsWithBookingCounts);
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
    res.json(shop);
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

module.exports = router;
