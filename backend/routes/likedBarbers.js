const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Shop = require('../models/Shop');
const BarberCard = require('../models/BarberCard');
const auth = require('../middleware/auth');

// @route   POST api/liked-barbers/add
// @desc    Add a barber/provider to liked list
// @access  Private
router.post('/add', auth, async (req, res) => {
  try {
    const { providerId, providerType } = req.body; // providerId can be barberId, shop owner _id, or staff _id

    if (!providerId || !providerType) {
      return res.status(400).json({ msg: 'Provider ID and type are required' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    // Check if already liked
    const existingLike = user.likedProviders.find(
      like => like.providerId.toString() === providerId && like.providerType === providerType
    );

    if (existingLike) {
      return res.status(400).json({ msg: 'Provider already liked' });
    }

    // Add to liked providers
    user.likedProviders.push({
      providerId,
      providerType,
      likedAt: new Date()
    });

    await user.save();

    res.json({
      msg: 'Provider added to favorites',
      likedProviders: user.likedProviders
    });
  } catch (err) {
    console.error('Error adding liked provider:', err.message);
    res.status(500).send('Server Error');
  }
});

// @route   DELETE api/liked-barbers/remove/:providerId/:providerType
// @desc    Remove a barber/provider from liked list
// @access  Private
router.delete('/remove/:providerId/:providerType', auth, async (req, res) => {
  try {
    const { providerId, providerType } = req.params;

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    const initialCount = user.likedProviders.length;

    // Remove from liked providers
    user.likedProviders = user.likedProviders.filter(
      like => !(like.providerId.toString() === providerId && like.providerType === providerType)
    );

    const finalCount = user.likedProviders.length;
    const removed = initialCount - finalCount;

    await user.save();

    res.json({
      msg: removed > 0 ? 'Provider removed from favorites' : 'Provider was not in favorites',
      removed: removed,
      likedProviders: user.likedProviders
    });
  } catch (err) {
    console.error('Error removing liked provider:', err.message);
    res.status(500).send('Server Error');
  }
});

// @route   GET api/liked-barbers
// @desc    Get all liked providers with full details
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    console.log('User likedProviders from DB:', user.likedProviders);

    const likedProviders = [];

    // Process each liked provider
    for (const like of user.likedProviders) {
      try {
        console.log('Processing liked provider:', like);
        let providerData = null;

        if (like.providerType === 'barber') {
          // Try to find as barber card first
          console.log('Looking for barber card with ID:', like.providerId);
          let barberCard = await BarberCard.findById(like.providerId);
          console.log('Barber card found:', !!barberCard);

          if (barberCard) {
            providerData = {
              _id: barberCard._id,
              id: barberCard._id,
              barberId: barberCard.barberId,
              name: barberCard.name,
              address: barberCard.address,
              image: barberCard.image,
              rating: barberCard.rating || 0,
              reviews: barberCard.reviews || [],
              reviewCount: barberCard.reviewCount || 0,
              services: barberCard.services || [],
              category: barberCard.category || 'Barber',
              avgAppointmentTime: barberCard.avgAppointmentTime || '30 min',
              totalServices: barberCard.services?.length || 0,
              isAvailable: barberCard.isAvailable || false,
              todaysBookings: barberCard.todaysBookings || 0,
              shopName: barberCard.shopName || 'Independent',
              type: 'barber',
              likedAt: like.likedAt
            };
          } else {
            // Try to find as shop owner or staff
            console.log('Barber card not found, looking for shop with owner/staff ID:', like.providerId);
            const shop = await Shop.findOne({
              $or: [
                { owner: like.providerId },
                { staff: like.providerId }
              ]
            });
            console.log('Shop found:', !!shop);

            if (shop) {
              let isOwner = shop.owner._id.toString() === like.providerId.toString();
              let personData = null;

              console.log('Shop owner ID:', shop.owner._id.toString(), 'Liked provider ID:', like.providerId.toString(), 'Is owner:', isOwner);

              if (isOwner) {
                console.log('Found as shop owner');
                // Fetch complete user data for the owner
                const ownerUser = await User.findById(shop.owner._id).select('name profilePicture rating reviews isAvailable maxAppointmentsPerDay todaysBookings');
                personData = {
                  _id: shop.owner._id,
                  name: ownerUser?.name || shop.owner.name || 'Unknown Owner',
                  profilePicture: ownerUser?.profilePicture || shop.owner.profilePicture,
                  rating: ownerUser?.rating || shop.owner.rating || 0,
                  reviews: ownerUser?.reviews || [],
                  reviewCount: ownerUser?.reviews?.length || 0,
                  isAvailable: ownerUser?.isAvailable || shop.owner.isAvailable || false,
                  maxAppointmentsPerDay: ownerUser?.maxAppointmentsPerDay || shop.owner.maxAppointmentsPerDay || 10,
                  todaysBookings: ownerUser?.todaysBookings || shop.owner.todaysBookings || 0
                };
              } else {
                console.log('Looking for staff member...');
                const staffMember = shop.staff.find(s => s._id.toString() === like.providerId.toString());
                console.log('Staff member found:', !!staffMember);
                if (staffMember) {
                  console.log('Found as staff member');
                  // Fetch complete user data for the staff member
                  const staffUser = await User.findById(staffMember._id).select('name profilePicture rating reviews isAvailable maxAppointmentsPerDay todaysBookings');
                  personData = {
                    _id: staffMember._id,
                    name: staffUser?.name || staffMember.name || 'Unknown Staff',
                    profilePicture: staffUser?.profilePicture || staffMember.profilePicture,
                    rating: staffUser?.rating || staffMember.rating || 0,
                    reviews: staffUser?.reviews || [],
                    reviewCount: staffUser?.reviews?.length || 0,
                    isAvailable: staffUser?.isAvailable || staffMember.isAvailable || false,
                    maxAppointmentsPerDay: staffUser?.maxAppointmentsPerDay || staffMember.maxAppointmentsPerDay || 10,
                    todaysBookings: staffUser?.todaysBookings || staffMember.todaysBookings || 0
                  };
                }
              }

              if (personData) {
                providerData = {
                  _id: personData._id,
                  id: personData._id,
                  barberId: personData._id,
                  name: personData.name,
                  address: shop.address || 'Location Unavailable',
                  image: { uri: personData.profilePicture || "https://via.placeholder.com/150" },
                  rating: personData.rating || 0,
                  reviews: personData.reviews || [],
                  reviewCount: personData.reviewCount || 0,
                  services: shop.services || [],
                  category: shop.category || 'Barber',
                  avgAppointmentTime: shop.avgAppointmentTime || '30 min',
                  totalServices: shop.services?.length || 0,
                  isAvailable: personData.isAvailable,
                  todaysBookings: personData.todaysBookings || 0,
                  shopName: shop.name,
                  type: 'barber',
                  likedAt: like.likedAt
                };
              }
            }
          }
        }

        if (providerData) {
          console.log('Adding provider data:', providerData.name);
          likedProviders.push(providerData);
        } else {
          console.log('No provider data found for:', like.providerId, '- creating basic entry');
          // If we can't find detailed data, create a basic entry so the user can still unlike
          const basicProviderData = {
            _id: like._id,
            id: like.providerId,
            barberId: like.providerId,
            name: 'Unknown Provider',
            address: 'Location Unavailable',
            image: { uri: "https://via.placeholder.com/150" },
            rating: 0,
            reviews: [],
            reviewCount: 0,
            services: [],
            category: like.providerType === 'barber' ? 'Barber' : 'Unknown',
            avgAppointmentTime: '30 min',
            totalServices: 0,
            isAvailable: false,
            todaysBookings: 0,
            shopName: 'Unknown',
            type: 'barber',
            likedAt: like.likedAt
          };
          likedProviders.push(basicProviderData);
        }
      } catch (err) {
        console.error('Error processing liked provider:', like.providerId, err.message);
        // Continue with other providers
      }
    }

    console.log('Final liked providers count:', likedProviders.length);

    // Sort by liked date (most recent first)
    likedProviders.sort((a, b) => new Date(b.likedAt) - new Date(a.likedAt));

    res.json({
      likedProviders,
      total: likedProviders.length
    });
  } catch (err) {
    console.error('Error fetching liked providers:', err.message);
    res.status(500).send('Server Error');
  }
});

// @route   GET api/liked-barbers/check/:providerId/:providerType
// @desc    Check if a provider is liked by the user
// @access  Private
router.get('/check/:providerId/:providerType', auth, async (req, res) => {
  try {
    const { providerId, providerType } = req.params;

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    const isLiked = user.likedProviders.some(
      like => like.providerId.toString() === providerId && like.providerType === providerType
    );

    res.json({ isLiked });
  } catch (err) {
    console.error('Error checking liked status:', err.message);
    res.status(500).send('Server Error');
  }
});

// @route   DELETE api/liked-barbers/clear
// @desc    Clear all liked providers (for cleanup)
// @access  Private
router.delete('/clear', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    user.likedProviders = [];
    await user.save();

    res.json({
      msg: 'All liked providers cleared',
      likedProviders: []
    });
  } catch (err) {
    console.error('Error clearing liked providers:', err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
