const mongoose = require('mongoose');
require('dotenv').config({ path: './backend/.env' }); // Explicitly load .env from backend directory
const User = require('./models/User'); // Assuming User model is in ./models/User.js

const createDummyBarber = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB Connected for dummy barber creation');

    const dummyBarber = new User({
      name: 'Demo Barber Shop',
      email: 'demo.barber@example.com',
      password: 'password123', // You might want to hash this in a real scenario
      phone: '+919876543210',
      role: 'barber',
      shopName: 'The Cutting Edge',
      shopAddress: '123 Barber Street, City, State, 12345',
      shopPhone: '+919988776655',
      shopRating: 4.8,
      shopReviews: 150,
    });

    await dummyBarber.save();
    console.log('Dummy barber created successfully!');
    console.log('Dummy Barber ID:', dummyBarber._id);
    
    mongoose.connection.close();
  } catch (error) {
    console.error('Error creating dummy barber:', error);
    mongoose.connection.close();
  }
};

createDummyBarber();
