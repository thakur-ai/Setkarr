const mongoose = require('mongoose');

const listingPlaceSchema = new mongoose.Schema({
  tierId: {
    type: Number,
    required: true,
    min: 1,
    max: 10,
  },
  category: {
    type: String,
    required: true,
    enum: ['Barber', 'Women\'s Salon', 'Pet Care'], // Define allowed categories
  },
  lockedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  lockedAt: {
    type: Date,
    default: Date.now,
  },
});

listingPlaceSchema.index({ tierId: 1, category: 1 }, { unique: true }); // Compound unique index

const ListingPlace = mongoose.model('ListingPlace', listingPlaceSchema);

module.exports = ListingPlace;
