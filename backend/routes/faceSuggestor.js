const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const User = require('../models/User'); // Assuming User model is used for tracking free uses

// Set up multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'backend/uploads/faces/'); // Store uploaded faces in a new directory
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage });

// Placeholder AI logic for suggestions
const getAISuggestions = (imagePath) => {
  // In a real application, this would involve:
  // 1. Sending the image to an external AI service (e.g., Google Cloud Vision, AWS Rekognition, or a custom model)
  // 2. Processing the AI response to extract face shape, features, etc.
  // 3. Using that information to suggest suitable hairstyles and beards.
  // For now, we'll return dummy data.
  console.log(`Processing image for AI suggestions: ${imagePath}`);
  return {
    hairstyles: ['Classic Pompadour', 'Textured Crop', 'Side Part'],
    beards: ['Stubble', 'Goatee', 'Full Beard'],
  };
};

// Route for face suggestion
router.post('/face-suggestor', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No image file uploaded.' });
  }

  const userId = req.user ? req.user.id : null; // Assuming user is authenticated and req.user is populated by auth middleware

  try {
    let user;
    if (userId) {
      user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found.' });
      }
    }

    // Check free uses
    if (user && user.faceSuggestorUses !== undefined && user.faceSuggestorUses <= 0) {
      // In a real scenario, this would trigger a payment flow
      return res.status(403).json({ message: 'Payment required for more suggestions.' });
    }

    const imagePath = req.file.path;
    const suggestions = getAISuggestions(imagePath);

    // Decrement free uses if applicable
    if (user && user.faceSuggestorUses > 0) {
      user.faceSuggestorUses -= 1;
      await user.save();
    } else if (user && user.faceSuggestorUses === undefined) {
      // Initialize if not present (first time user)
      user.faceSuggestorUses = 1; // 2 free uses, so after first use, 1 left
      await user.save();
    }

    res.status(200).json({
      message: 'Image uploaded and suggestions generated successfully.',
      suggestions: suggestions,
      usesLeft: user ? user.faceSuggestorUses : null, // Return remaining uses
    });

  } catch (error) {
    console.error('Error in face suggestor:', error);
    res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;
