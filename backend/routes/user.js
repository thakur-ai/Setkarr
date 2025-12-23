const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const SetkarCoinTransaction = require('../models/SetkarCoinTransaction');

// @route   POST api/user/recharge-setkar-coins
// @desc    Recharge Setkar coins for a user (bypassing actual payment for now)
// @access  Private
router.post('/recharge-setkar-coins', auth, async (req, res) => {
  try {
    const { coins } = req.body;

    if (typeof coins !== 'number' || coins <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid coin amount.' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    let totalCoins = coins;
    let bonusCoins = 0;

    // Special offer: 10% extra coins for ₹100 recharge
    if (coins === 100) {
      bonusCoins = 10; // 10% of 100
      totalCoins = coins + bonusCoins;
    }

    user.setkarCoins = (user.setkarCoins || 0) + totalCoins;
    await user.save();

    // Create transaction record for main recharge
    const transaction = new SetkarCoinTransaction({
      userId: req.user.id,
      type: 'recharge',
      amount: coins,
      description: bonusCoins > 0 ? `Recharged ${coins} Setkar Coins + ${bonusCoins} bonus coins (10% extra)` : `Recharged ${coins} Setkar Coins`,
    });
    await transaction.save();

    // Create separate transaction record for bonus if applicable
    if (bonusCoins > 0) {
      const bonusTransaction = new SetkarCoinTransaction({
        userId: req.user.id,
        type: 'recharge',
        amount: bonusCoins,
        description: `Bonus: ${bonusCoins} Setkar Coins (10% extra on ₹100 recharge)`,
      });
      await bonusTransaction.save();
    }

    const message = bonusCoins > 0
      ? `Setkar Coins recharged successfully! You received ${coins} + ${bonusCoins} bonus coins (10% extra).`
      : 'Setkar Coins recharged successfully.';

    res.json({
      success: true,
      message: message,
      setkarCoins: user.setkarCoins,
      bonusCoins: bonusCoins
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// @route   POST api/user/redeem-setkar-coins
// @desc    Redeem Setkar coins for a user
// @access  Private
router.post('/redeem-setkar-coins', auth, async (req, res) => {
  try {
    const { coins } = req.body;

    if (typeof coins !== 'number' || coins <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid coin amount.' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (user.setkarCoins < coins) {
      return res.status(400).json({ success: false, message: 'Insufficient Setkar Coins.' });
    }

    user.setkarCoins -= coins;
    await user.save();

    // Create transaction record
    const transaction = new SetkarCoinTransaction({
      userId: req.user.id,
      type: 'redeem',
      amount: coins,
      description: `Redeemed ${coins} Setkar Coins`,
    });
    await transaction.save();

    res.json({ success: true, message: 'Setkar Coins redeemed successfully.', setkarCoins: user.setkarCoins });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// @route   GET api/user/setkar-coin-transactions
// @desc    Get Setkar coin transaction history for a user
// @access  Private
router.get('/setkar-coin-transactions', auth, async (req, res) => {
  try {
    const transactions = await SetkarCoinTransaction.find({ userId: req.user.id })
      .sort({ date: -1 }) // Most recent first
      .select('type amount description date');

    res.json({ success: true, transactions });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
