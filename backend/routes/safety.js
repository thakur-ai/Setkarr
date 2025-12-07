const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');

// @route   GET api/safety/settings
// @desc    Get safety settings
// @access  Private
router.get('/settings', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.json({
      safetyHelp: user.safetyHelp,
      isAudioRecordingEnabled: user.isAudioRecordingEnabled,
      emergencyContacts: user.emergencyContacts,
      trustedContactsList: user.trustedContacts,
      trustedContactsEnabled: user.trustedContactsEnabled,
      rideCheck: user.rideCheck,
      driverSafetyStandards: user.driverSafetyStandards,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   POST api/safety/trusted-contacts
// @desc    Add a trusted contact
// @access  Private
router.post('/trusted-contacts', auth, async (req, res) => {
  const { name, phoneNumber } = req.body;

  try {
    const user = await User.findById(req.user.id);
    user.trustedContacts.push({ name, phone: phoneNumber });
    await user.save();
    res.json(user.trustedContacts);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   PUT api/safety/trusted-contacts/:id
// @desc    Update a trusted contact
// @access  Private
router.put('/trusted-contacts/:id', auth, async (req, res) => {
  const { name, phoneNumber } = req.body;

  try {
    const user = await User.findById(req.user.id);
    const contact = user.trustedContacts.id(req.params.id);
    if (name) contact.name = name;
    if (phoneNumber) contact.phone = phoneNumber;
    await user.save();
    res.json(user.trustedContacts);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   DELETE api/safety/trusted-contacts/:id
// @desc    Delete a trusted contact
// @access  Private
router.delete('/trusted-contacts/:id', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    user.trustedContacts.id(req.params.id).remove();
    await user.save();
    res.json(user.trustedContacts);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
