const mongoose = require('mongoose');

const exclusiveDealSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  image: {
    type: String, // URL or path to image
  },
  discountPercentage: {
    type: Number,
    default: 0,
  },
  bonusCoins: {
    type: Number,
    default: 0,
  },
  minimumPurchase: {
    type: Number,
    default: 0,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  validUntil: {
    type: Date,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

const ExclusiveDeal = mongoose.model('ExclusiveDeal', exclusiveDealSchema);

module.exports = ExclusiveDeal;
