const mongoose = require('mongoose');
const User = require('./models/User');
const Booking = require('./models/Booking');

const MONGO_URI = 'mongodb://localhost:27017/barber-app';

const createTestData = async () => {
  try {
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB connected');

    const shop = await Shop.findOne({ name: 'Navi Mumbai Shop. Kada' });
    if (!shop) {
      console.error('Could not find shop with name "Navi Mumbai Shop. Kada". Please check the name.');
      return;
    }

    const barber = await User.findById(shop.owner);
    if (!barber) {
      console.error(`Could not find barber with owner ID ${shop.owner}.`);
      return;
    }
    console.log(`Found barber: ${barber.name} (Max appointments: ${barber.maxAppointmentsPerDay})`);

    const customer = await User.findOne({ role: 'customer' });
    if (!customer) {
      console.error('No customer found in the database.');
      return;
    }
    console.log(`Found customer: ${customer.name}`);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const deleteResult = await Booking.deleteMany({
      barberId: barber._id,
      date: {
        $gte: today,
        $lt: tomorrow,
      },
    });
    console.log(`Deleted ${deleteResult.deletedCount} existing bookings for today.`);

    const bookingsToCreate = [];
    for (let i = 0; i < barber.maxAppointmentsPerDay; i++) {
      bookingsToCreate.push({
        userId: customer._id,
        barberId: barber._id,
        date: today,
        time: `10:${i.toString().padStart(2, '0')}:00 AM`,
        services: [{ id: '1', name: 'Test Service', price: '100' }],
        totalPrice: 100,
        appointmentType: 'Basic',
      });
    }

    const createdBookings = await Booking.insertMany(bookingsToCreate);
    console.log(`Created ${createdBookings.length} new 'Basic' bookings for today.`);

  } catch (err) {
    console.error('Error creating test data:', err);
  } finally {
    await mongoose.disconnect();
    console.log('MongoDB disconnected');
  }
};

createTestData();
