const express = require('express');
const router = express.Router();
const mongoose = require('mongoose'); // Import mongoose
const ChatMessage = require('../models/ChatMessage');
const User = require('../models/User'); // Assuming User model exists
const auth = require('../middleware/auth'); // Assuming auth middleware exists

// @route   POST api/chat/send
// @desc    Send a chat message
// @access  Private
router.post('/send', auth, async (req, res) => {
  const { receiverId, message, appType } = req.body;
  console.log('Received receiverId:', receiverId);

  try {
    const sender = req.user.id; // From auth middleware
    const receiver = await User.findById(receiverId);

    if (!receiver) {
      console.log('Receiver not found in database');
      return res.status(404).json({ msg: 'Receiver not found' });
    }

    const newChatMessage = new ChatMessage({
      sender,
      receiver: receiverId,
      message,
      appType,
    });

    await newChatMessage.save();
    res.json(newChatMessage);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   GET api/chat/:receiverId
// @desc    Get chat history between current user and a specific receiver
// @access  Private
router.get('/:receiverId', auth, async (req, res) => {
  try {
    const senderId = req.user.id; // Current authenticated user
    const receiverId = req.params.receiverId;

    const messages = await ChatMessage.find({
      $or: [
        { sender: senderId, receiver: receiverId },
        { sender: receiverId, receiver: senderId },
      ],
    }).sort({ timestamp: 1 }); // Sort by timestamp ascending

    res.json(messages);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   GET api/chat/admin/conversations
// @desc    Get a list of all users who have chatted with the admin
// @access  Private (Admin only)
router.get('/admin/conversations', async (req, res) => { // Temporarily removed 'auth' middleware for debugging
  try {
    const adminId = '654a7e1c8e9d7b001f8e9d7b'; // Hardcoded admin ID for debugging

    // Find distinct senders who have sent messages to this admin
    const conversations = await ChatMessage.aggregate([
      {
        $match: {
          $or: [
            { receiver: new mongoose.Types.ObjectId(adminId) },
            { sender: new mongoose.Types.ObjectId(adminId) },
          ],
        },
      },
      {
        $group: {
          _id: '$sender',
          lastMessage: { $last: '$message' },
          timestamp: { $last: '$timestamp' },
          appType: { $last: '$appType' },
        },
      },
      {
        $lookup: {
          from: 'users', // The collection name for the User model
          localField: '_id',
          foreignField: '_id',
          as: 'senderInfo',
        },
      },
      {
        $unwind: '$senderInfo',
      },
      {
        $project: {
          _id: '$senderInfo._id',
          name: '$senderInfo.name',
          email: '$senderInfo.email',
          lastMessage: 1,
          timestamp: 1,
          appType: 1,
        },
      },
      {
        $sort: { timestamp: -1 }, // Sort by most recent conversation
      },
    ]);

    res.json(conversations);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
