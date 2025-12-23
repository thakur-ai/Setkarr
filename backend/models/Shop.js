const mongoose = require('mongoose');

const shopSchema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  staff: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  name: {
    type: String,
    required: true,
  },
  address: {
    type: String,
    required: true,
  },
  phone: {
    type: String,
    required: true,
  },
  image: {
    type: String,
  },
  rating: {
    type: Number,
    min: 0,
    max: 5,
    default: 0,
  },
  reviews: {
    type: Number,
    default: 0,
  },
  services: [
    {
      id: String,
      name: String,
      price: String,
      time: String,
      barberId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    },
  ],
  category: {
    type: String,
    enum: ["Barber", "Women's Salon", "Pet Care", "Unisex"],
    default: 'Unisex',
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
    },
    coordinates: {
      type: [Number],
    },
  },
  avgAppointmentTime: {
    type: String,
    default: '0 min',
  },
  isAvailable: {
    type: Boolean,
    default: false,
  },
  tag: {
    type: String,
  },
  selectedListingPlace: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ListingPlace',
  },
  listingConfirmed: {
    type: Boolean,
    default: false,
  },
  clickCount: {
    type: Number,
    default: 0,
  },
  upiId: {
    type: String,
  },
});

const Shop = mongoose.model('Shop', shopSchema);

module.exports = Shop;
