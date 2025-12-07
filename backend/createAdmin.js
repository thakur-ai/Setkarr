const mongoose = require('mongoose');
const User = require('./models/User');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const createAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB connected');

    const adminId = '654a7e1c8e9d7b001f8e9d7b';
    const adminExists = await User.findById(adminId);

    if (adminExists) {
      console.log('Admin user already exists.');
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('password123', salt);

    const adminUser = new User({
      _id: new mongoose.Types.ObjectId(adminId),
      name: 'Support Admin',
      email: 'support@setkarr.com',
      password: hashedPassword,
      phone: '1234567890',
      role: 'customer', 
    });

    await adminUser.save();
    console.log('Admin user created successfully.');

  } catch (err) {
    console.error('Error creating admin user:', err);
  } finally {
    await mongoose.disconnect();
    console.log('MongoDB disconnected');
  }
};

createAdmin();
