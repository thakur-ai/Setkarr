const mongoose = require('mongoose');

const AdPlacementSchema = new mongoose.Schema({
  barberId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // Assuming 'User' is the model for barbers
    required: true,
  },
  videoUrl: {
    type: String,
    required: false, // Make videoUrl optional
  },
  mediaUrl: {
    type: String,
    required: false, // URL for uploaded image/video
  },
  mediaType: {
    type: String,
    enum: ['youtube', 'image', 'video'], // Type of media: YouTube, image, or uploaded video
    required: false,
  },
  startDate: {
    type: Date,
    required: true,
  },
  endDate: {
    type: Date,
    required: true,
  },
  price: {
    type: Number,
    required: true,
    default: 999, // 999 Rs for 10 days
  },
  status: {
    type: String,
    enum: ['pending', 'active', 'expired', 'booked'], // 'booked' for future, 'active' for current
    default: 'pending',
  },
  isBooked: {
    type: Boolean,
    default: false,
  },
  bookedAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('AdPlacement', AdPlacementSchema);
