import express from 'express';
import Order from '../models/Order.js';
import Gig from '../models/Gig.js';
import User from '../models/User.js';
import { authenticateToken } from '../middleware/auth.js';
import { createNotification } from '../utils/notifications.js';

const router = express.Router();

// Initialize Stripe with proper error handling
let stripe;
try {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.warn('⚠️  STRIPE_SECRET_KEY not found in environment variables. Stripe functionality will be disabled.');
    stripe = null;
  } else {
    const Stripe = (await import('stripe')).default;
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    console.log('✅ Stripe initialized successfully');
  }
} catch (error) {
  console.error('❌ Failed to initialize Stripe:', error.message);
  stripe = null;
}

// Create checkout session
router.post('/create-checkout-session', authenticateToken, async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({
        message: 'Payment service is currently unavailable. Please contact support.',
        error: 'Stripe not configured'
      });
    }

    const { gigId, packageType, customRequirements = [] } = req.body;
    const buyerId = req.user._id;

    // Get gig details
    const gig = await Gig.findById(gigId).populate('freelancer');
    if (!gig || !gig.isActive || gig.isPaused) {
      return res.status(404).json({ message: 'Gig not available' });
    }

    // Prevent self-purchase
    if (gig.freelancer._id.toString() === buyerId.toString()) {
      return res.status(400).json({ message: 'Cannot purchase your own gig' });
    }

    // Get package details
    const packageDetails = gig.pricing[packageType];
    if (!packageDetails) {
      return res.status(400).json({ message: 'Invalid package type' });
    }

    // Calculate fees
    const subtotal = packageDetails.price;
    const serviceFee = Math.max(2, Math.round(subtotal * 0.05 * 100) / 100); // 5% service fee, minimum $2
    const totalAmount = subtotal + serviceFee;
    const netAmount = subtotal - Math.round(subtotal * 0.2 * 100) / 100; // 20% platform fee

    // Create order
    const order = new Order({
      buyer: buyerId,
      seller: gig.freelancer._id,
      gig: gigId,
      package: packageType,
      packageDetails: {
        title: packageDetails.title,
        description: packageDetails.description,
        price: packageDetails.price,
        deliveryTime: packageDetails.deliveryTime,
        revisions: packageDetails.revisions,
        features: packageDetails.features || []
      },
      customRequirements,
      totalAmount,
      serviceFee,
      netAmount,
      paymentIntentId: 'temp_' + Date.now() // Temporary, will be updated after payment
    });

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: gig.title,
              description: `${packageDetails.title} - ${packageDetails.description}`,
              images: gig.images.slice(0, 1).map(img => img.url)
            },
            unit_amount: Math.round(subtotal * 100)
          },
          quantity: 1
        },
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Service Fee',
              description: 'Platform service fee'
            },
            unit_amount: Math.round(serviceFee * 100)
          },
          quantity: 1
        }
      ],
      mode: 'payment',
      success_url: `${process.env.CLIENT_URL}/order-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/gig/${gigId}`,
      metadata: {
        orderId: order._id.toString(),
        gigId: gigId,
        buyerId: buyerId.toString(),
        sellerId: gig.freelancer._id.toString()
      }
    });

    // Update order with session ID
    order.stripeSessionId = session.id;
    order.paymentIntentId = session.payment_intent || session.id;
    await order.save();

    res.json({
      sessionId: session.id,
      orderId: order._id,
      url: session.url
    });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    res.status(500).json({
      message: 'Error creating checkout session',
      error: error.message
    });
  }
});

// Handle successful payment
router.get('/success/:sessionId', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Retrieve the session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    if (session.payment_status !== 'paid') {
      return res.status(400).json({ message: 'Payment not completed' });
    }

    // Find and update order
    const order = await Order.findOne({ stripeSessionId: sessionId });
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Update order status
    order.paymentStatus = 'paid';
    order.status = 'requirements_pending';
    order.paymentIntentId = session.payment_intent;
    
    // Set delivery date
    const deliveryDate = new Date();
    deliveryDate.setDate(deliveryDate.getDate() + order.packageDetails.deliveryTime);
    order.deliveryDate = deliveryDate;

    await order.save();

    // Create notifications
    await Promise.all([
      createNotification({
        recipient: order.seller,
        sender: order.buyer,
        type: 'new_order',
        title: 'New Order Received',
        message: `You have a new order for ${order.packageDetails.title}`,
        data: { orderId: order._id }
      }),
      createNotification({
        recipient: order.buyer,
        type: 'payment_received',
        title: 'Payment Successful',
        message: `Your payment for ${order.packageDetails.title} was successful`,
        data: { orderId: order._id }
      })
    ]);

    res.json({
      message: 'Payment successful',
      order: await order.populate([
        { path: 'buyer', select: 'username fullName avatar' },
        { path: 'seller', select: 'username fullName avatar' },
        { path: 'gig', select: 'title images' }
      ])
    });
  } catch (error) {
    console.error('Payment success error:', error);
    res.status(500).json({
      message: 'Error processing successful payment',
      error: error.message
    });
  }
});

// Stripe webhook handler
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        const session = event.data.object;
        
        // Update order status
        const order = await Order.findOne({ stripeSessionId: session.id });
        if (order && order.paymentStatus !== 'paid') {
          order.paymentStatus = 'paid';
          order.status = 'requirements_pending';
          order.paymentIntentId = session.payment_intent;
          await order.save();

          // Create notifications
          await Promise.all([
            createNotification({
              recipient: order.seller,
              sender: order.buyer,
              type: 'new_order',
              title: 'New Order Received',
              message: 'You have a new order',
              data: { orderId: order._id }
            }),
            createNotification({
              recipient: order.buyer,
              type: 'payment_received',
              title: 'Payment Successful',
              message: 'Your payment was successful',
              data: { orderId: order._id }
            })
          ]);
        }
        break;

      case 'payment_intent.payment_failed':
        const paymentIntent = event.data.object;
        
        // Update order status
        const failedOrder = await Order.findOne({ paymentIntentId: paymentIntent.id });
        if (failedOrder) {
          failedOrder.paymentStatus = 'failed';
          failedOrder.status = 'cancelled';
          await failedOrder.save();

          // Notify buyer
          await createNotification({
            recipient: failedOrder.buyer,
            type: 'system',
            title: 'Payment Failed',
            message: 'Your payment could not be processed',
            data: { orderId: failedOrder._id }
          });
        }
        break;

      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});

// Create custom offer payment
router.post('/create-custom-offer-payment', authenticateToken, async (req, res) => {
  try {
    const { 
      receiverId, 
      title, 
      description, 
      price, 
      deliveryTime, 
      revisions = 0 
    } = req.body;
    const sellerId = req.user._id;

    // Validate inputs
    if (price < 5) {
      return res.status(400).json({ message: 'Minimum price is $5' });
    }

    // Calculate fees
    const serviceFee = Math.max(2, Math.round(price * 0.05 * 100) / 100);
    const totalAmount = price + serviceFee;
    const netAmount = price - Math.round(price * 0.2 * 100) / 100;

    // Create order
    const order = new Order({
      buyer: receiverId,
      seller: sellerId,
      gig: null, // Custom offer doesn't have associated gig
      package: 'custom',
      packageDetails: {
        title,
        description,
        price,
        deliveryTime,
        revisions,
        features: []
      },
      totalAmount,
      serviceFee,
      netAmount,
      paymentIntentId: 'temp_' + Date.now()
    });

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: title,
              description: description
            },
            unit_amount: Math.round(price * 100)
          },
          quantity: 1
        },
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Service Fee',
              description: 'Platform service fee'
            },
            unit_amount: Math.round(serviceFee * 100)
          },
          quantity: 1
        }
      ],
      mode: 'payment',
      success_url: `${process.env.CLIENT_URL}/order-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/messages`,
      metadata: {
        orderId: order._id.toString(),
        buyerId: receiverId.toString(),
        sellerId: sellerId.toString(),
        isCustomOffer: 'true'
      }
    });

    order.stripeSessionId = session.id;
    order.paymentIntentId = session.payment_intent || session.id;
    await order.save();

    res.json({
      sessionId: session.id,
      orderId: order._id,
      url: session.url
    });
  } catch (error) {
    console.error('Custom offer payment error:', error);
    res.status(500).json({
      message: 'Error creating custom offer payment',
      error: error.message
    });
  }
});

// Get payment analytics (seller)
router.get('/analytics', authenticateToken, async (req, res) => {
  try {
    const sellerId = req.user._id;
    const { period = '30d' } = req.query;

    let dateFilter = {};
    const now = new Date();
    
    switch (period) {
      case '7d':
        dateFilter = { createdAt: { $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } };
        break;
      case '30d':
        dateFilter = { createdAt: { $gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } };
        break;
      case '90d':
        dateFilter = { createdAt: { $gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) } };
        break;
      case '1y':
        dateFilter = { createdAt: { $gte: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000) } };
        break;
    }

    const analytics = await Order.aggregate([
      {
        $match: {
          seller: sellerId,
          paymentStatus: 'paid',
          ...dateFilter
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$netAmount' },
          totalOrders: { $sum: 1 },
          averageOrderValue: { $avg: '$netAmount' }
        }
      }
    ]);

    const monthlyRevenue = await Order.aggregate([
      {
        $match: {
          seller: sellerId,
          paymentStatus: 'paid',
          createdAt: { $gte: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000) }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          revenue: { $sum: '$netAmount' },
          orders: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    res.json({
      analytics: analytics[0] || {
        totalRevenue: 0,
        totalOrders: 0,
        averageOrderValue: 0
      },
      monthlyRevenue
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching payment analytics',
      error: error.message
    });
  }
});

export default router;