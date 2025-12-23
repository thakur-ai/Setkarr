const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const AdPlacement = require('../models/AdPlacement');
const Shop = require('../models/Shop'); // Import Shop model
const auth = require('../middleware/auth'); // Assuming you have an auth middleware

// Set up multer for file storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/ads'); // Store ad media in backend/uploads/ads
  },
  filename: (req, file, cb) => {
    cb(null, `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 100000000 }, // 100MB limit
  fileFilter: (req, file, cb) => {
    checkFileType(file, cb);
  },
});

// Check file type
function checkFileType(file, cb) {
  const filetypes = /jpeg|jpg|png|mp4|mov|avi|wmv/; // Allowed file extensions
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = filetypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb('Error: Images and Videos Only!');
  }
}

// Create a new ad placement (capture multer errors explicitly)
router.post('/', auth, (req, res) => {
  upload.single('media')(req, res, async (uploadErr) => {
    if (uploadErr) {
      console.error('Multer upload error:', uploadErr);
      // Multer error types: LIMIT_FILE_SIZE, etc.
      return res.status(400).json({ msg: uploadErr.message || 'File upload failed' });
    }

    try {
      const { videoUrl, startDate, endDate, price } = req.body;
      const barberId = req.user.id; // Assuming auth middleware adds user to req

      // Log incoming request for debugging
      console.log('POST /api/ads - headers content-type:', req.headers['content-type']);
      console.log('POST /api/ads - body:', { videoUrl, startDate, endDate, price });
      if (req.file) {
        console.log('POST /api/ads - file received:', { filename: req.file.filename, mimetype: req.file.mimetype, size: req.file.size });
      }
      // Warn if multipart looks suspiciously small (helps detect missing file payloads)
      if (!req.file && !videoUrl) {
        const contentLength = Number(req.headers['content-length'] || 0);
        if (contentLength && contentLength < 200) {
          console.warn('Incoming multipart/form-data request appears too small (no file): content-length =', contentLength);
        }
      }

      // Validate required fields early
      if (!startDate || !endDate) {
        return res.status(400).json({ msg: 'startDate and endDate are required' });
      }
      const sDate = new Date(startDate);
      const eDate = new Date(endDate);
      if (isNaN(sDate.getTime()) || isNaN(eDate.getTime())) {
        return res.status(400).json({ msg: 'Invalid startDate or endDate' });
      }

      // Check if any ad placement is currently booked by any barber
      const existingAd = await AdPlacement.findOne({
        isBooked: true,
        endDate: { $gte: new Date() } // Check if the ad is still active or booked for the future
      });

      if (existingAd) {
        return res.status(400).json({ msg: 'An ad placement is currently booked. No new ad placements can be created at this time.' });
      }

      let adData = {
        barberId,
        startDate,
        endDate,
        price,
        status: 'pending',
        isBooked: true,
      };

      if (req.file) {
        adData.mediaUrl = `/uploads/ads/${req.file.filename}`;
        if (req.file.mimetype.startsWith('image')) {
          adData.mediaType = 'image';
        } else if (req.file.mimetype.startsWith('video')) {
          adData.mediaType = 'video';
        }
      } else if (videoUrl) {
        adData.videoUrl = videoUrl;
        adData.mediaType = 'youtube';
      } else {
        console.warn('No file or videoUrl provided. req.headers:', req.headers);
        return res.status(400).json({ msg: 'Please provide a video URL or upload an image/video.' });
      }

      const newAd = new AdPlacement(adData);

      const ad = await newAd.save();
      console.log('Ad placement created:', ad._id);
      res.json(ad);
    } catch (err) {
      console.error('Error in POST /api/ads:', err.stack || err);
      // If mongoose validation error, return 400 with details
      if (err.name === 'ValidationError') {
        const messages = Object.values(err.errors).map(e => e.message);
        return res.status(400).json({ msg: 'Validation Error', errors: messages });
      }
      res.status(500).json({ msg: 'Server Error', error: err.message });
    }
  });
});

// Get active ad for homepage banner
router.get('/active', async (req, res) => {
  try {
    const now = new Date();
    const activeAd = await AdPlacement.findOne({
      startDate: { $lte: now },
      endDate: { $gte: now },
      isBooked: true,
      status: 'active', // Only show active ads
    }).populate('barberId', 'name profilePicture'); // Only populate name and profilePicture from User

    if (!activeAd) {
      return res.status(404).json({ msg: 'No active ad found' });
    }

    // Now, fetch the shop name separately
    if (activeAd.barberId) {
      const Shop = require('../models/Shop'); // Import Shop model
      const shop = await Shop.findOne({ owner: activeAd.barberId._id });
      if (shop) {
        activeAd.barberId.shopName = shop.name; // Add shopName to the barberId object
      } else {
        activeAd.barberId.shopName = 'Unknown Shop'; // Default if no shop found
      }
    }

    res.json(activeAd);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// Get all ad placements (for admin or debugging)
router.get('/', auth, async (req, res) => {
  try {
    const ads = await AdPlacement.find().populate('barberId', 'name');
    res.json(ads);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// Get ad placements by barber ID
router.get('/barber/:barberId', auth, async (req, res) => {
  try {
    const ads = await AdPlacement.find({ barberId: req.params.barberId }).populate('barberId', 'name');
    if (!ads) {
      return res.status(404).json({ msg: 'No ad placements found for this barber' });
    }
    res.json(ads);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// Get the latest end date of any booked ad placement for a specific barber
router.get('/barber/:barberId/latest-end-date', auth, async (req, res) => {
  try {
    const latestAd = await AdPlacement.findOne({
      barberId: req.params.barberId,
      isBooked: true // Consider only booked ads
    }).sort({ endDate: -1 });

    if (latestAd) {
      res.json({ latestEndDate: latestAd.endDate });
    } else {
      res.json({ latestEndDate: null });
    }
  } catch (err) {
    console.error('Error in GET /api/ads/barber/:barberId/latest-end-date:', err);
    res.status(500).send('Server Error');
  }
});

// Get the latest end date of any booked ad placement
router.get('/latest-end-date', async (req, res) => {
  console.log('Attempting to fetch latest overall ad end date...');
  try {
    const latestAd = await AdPlacement.findOne({ isBooked: true }).sort({ endDate: -1 });
    if (latestAd) {
      console.log('Latest ad found:', latestAd.endDate);
      res.json({ latestEndDate: latestAd.endDate });
    } else {
      console.log('No latest ad found.');
      res.json({ latestEndDate: null });
    }
  } catch (err) {
    console.error('Error in GET /api/ads/latest-end-date:', err);
    res.status(500).send('Server Error');
  }
});

// Get a specific ad placement by ID
router.get('/:id', auth, async (req, res) => {
  try {
    const ad = await AdPlacement.findById(req.params.id).populate('barberId', 'name'); // Removed shopName
    if (!ad) {
      return res.status(404).json({ msg: 'Ad placement not found' });
    }
    res.json(ad);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// Update an ad placement (e.g., status, videoUrl, media)
router.put('/:id', auth, upload.single('media'), async (req, res) => {
  try {
    const { videoUrl, startDate, endDate, status, isBooked } = req.body;

    let ad = await AdPlacement.findById(req.params.id);
    if (!ad) {
      return res.status(404).json({ msg: 'Ad placement not found' });
    }

    // Ensure only the barber who owns the ad or an admin can update it
    if (ad.barberId.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(401).json({ msg: 'Not authorized to update this ad' });
    }

    // Handle media update
    if (req.file) {
      ad.mediaUrl = `/uploads/ads/${req.file.filename}`;
      if (req.file.mimetype.startsWith('image')) {
        ad.mediaType = 'image';
      } else if (req.file.mimetype.startsWith('video')) {
        ad.mediaType = 'video';
      }
      ad.videoUrl = undefined; // Clear YouTube URL if new media is uploaded
    } else if (videoUrl) {
      ad.videoUrl = videoUrl;
      ad.mediaType = 'youtube';
      ad.mediaUrl = undefined; // Clear uploaded media URL if new YouTube URL is provided
    }

    ad.startDate = startDate || ad.startDate;
    ad.endDate = endDate || ad.endDate;
    ad.status = status || ad.status;
    ad.isBooked = isBooked !== undefined ? isBooked : ad.isBooked;

    await ad.save();
    res.json(ad);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// Delete an ad placement
router.delete('/:id', auth, async (req, res) => {
  try {
    const ad = await AdPlacement.findById(req.params.id);
    if (!ad) {
      return res.status(404).json({ msg: 'Ad placement not found' });
    }

    // Ensure only the barber who owns the ad or an admin can delete it
    if (ad.barberId.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(401).json({ msg: 'Not authorized to delete this ad' });
    }

    await AdPlacement.findByIdAndDelete(req.params.id);
    res.json({ msg: 'Ad placement removed' });
  } catch (err) {
    console.error('Error in POST /api/ads:', err);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
