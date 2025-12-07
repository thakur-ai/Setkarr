const express = require('express');
const router = express.Router();
const ListingPlace = require('../models/ListingPlace');

router.get('/', (req, res) => {
  res.send('Hello World!');
});

// @route   DELETE api/test/clear-locked-places
// @desc    Clear all locked places
// @access  Public
router.delete('/clear-locked-places', async (req, res) => {
  try {
    await ListingPlace.deleteMany({});
    res.json({ msg: 'All locked places have been cleared.' });
  } catch (err) {
    console.error('Error clearing locked places:', err);
    res.status(500).json({ msg: 'Server Error', error: err.message });
  }
});

module.exports = router;
