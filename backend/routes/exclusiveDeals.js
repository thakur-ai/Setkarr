const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const ExclusiveDeal = require('../models/ExclusiveDeal');

// @route   GET api/exclusive-deals
// @desc    Get all active exclusive deals
// @access  Public
router.get('/', async (req, res) => {
  try {
    const deals = await ExclusiveDeal.find({ isActive: true })
      .sort({ createdAt: -1 });

    res.json({ success: true, deals });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// @route   GET api/exclusive-deals/:id
// @desc    Get a specific exclusive deal
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const deal = await ExclusiveDeal.findById(req.params.id);

    if (!deal) {
      return res.status(404).json({ success: false, message: 'Deal not found.' });
    }

    res.json({ success: true, deal });
  } catch (err) {
    console.error(err.message);
    if (err.kind === 'ObjectId') {
      return res.status(404).json({ success: false, message: 'Deal not found.' });
    }
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// @route   POST api/exclusive-deals
// @desc    Create a new exclusive deal (Admin only)
// @access  Private (Admin)
router.post('/', auth, async (req, res) => {
  try {
    // TODO: Add admin role check here
    const { title, description, image, discountPercentage, bonusCoins, minimumPurchase, validUntil } = req.body;

    const newDeal = new ExclusiveDeal({
      title,
      description,
      image,
      discountPercentage: discountPercentage || 0,
      bonusCoins: bonusCoins || 0,
      minimumPurchase: minimumPurchase || 0,
      validUntil,
    });

    const deal = await newDeal.save();
    res.json({ success: true, deal });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// @route   PUT api/exclusive-deals/:id
// @desc    Update an exclusive deal (Admin only)
// @access  Private (Admin)
router.put('/:id', auth, async (req, res) => {
  try {
    // TODO: Add admin role check here
    const { title, description, image, discountPercentage, bonusCoins, minimumPurchase, isActive, validUntil } = req.body;

    const deal = await ExclusiveDeal.findById(req.params.id);

    if (!deal) {
      return res.status(404).json({ success: false, message: 'Deal not found.' });
    }

    deal.title = title || deal.title;
    deal.description = description || deal.description;
    deal.image = image || deal.image;
    deal.discountPercentage = discountPercentage !== undefined ? discountPercentage : deal.discountPercentage;
    deal.bonusCoins = bonusCoins !== undefined ? bonusCoins : deal.bonusCoins;
    deal.minimumPurchase = minimumPurchase !== undefined ? minimumPurchase : deal.minimumPurchase;
    deal.isActive = isActive !== undefined ? isActive : deal.isActive;
    deal.validUntil = validUntil || deal.validUntil;
    deal.updatedAt = Date.now();

    await deal.save();
    res.json({ success: true, deal });
  } catch (err) {
    console.error(err.message);
    if (err.kind === 'ObjectId') {
      return res.status(404).json({ success: false, message: 'Deal not found.' });
    }
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// @route   DELETE api/exclusive-deals/:id
// @desc    Delete an exclusive deal (Admin only)
// @access  Private (Admin)
router.delete('/:id', auth, async (req, res) => {
  try {
    // TODO: Add admin role check here
    const deal = await ExclusiveDeal.findById(req.params.id);

    if (!deal) {
      return res.status(404).json({ success: false, message: 'Deal not found.' });
    }

    await deal.remove();
    res.json({ success: true, message: 'Deal removed.' });
  } catch (err) {
    console.error(err.message);
    if (err.kind === 'ObjectId') {
      return res.status(404).json({ success: false, message: 'Deal not found.' });
    }
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
