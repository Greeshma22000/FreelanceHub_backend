import express from 'express';
import Order from '../models/Order.js';
import Gig from '../models/Gig.js';
import User from '../models/User.js';
import { authenticateToken } from '../middleware/auth.js';
import { createNotification } from '../utils/notifications.js';

const router = express.Router();

// Get user orders
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { status, role = 'buyer' } = req.query;
    const userId = req.user._id;
    
    let query = {};
    if (role === 'buyer') {
      query.buyer = userId;
    } else {
      query.seller = userId;
    }
    
    if (status && status !== 'all') {
      query.status = status;
    }

    const orders = await Order.find(query)
      .populate('buyer', 'username fullName avatar')
      .populate('seller', 'username fullName avatar')
      .populate('gig', 'title images pricing')
      .sort({ createdAt: -1 });

    res.json(orders);
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching orders',
      error: error.message
    });
  }
});

// Get single order
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('buyer', 'username fullName avatar email')
      .populate('seller', 'username fullName avatar email')
      .populate('gig', 'title images pricing description');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Check if user is authorized to view this order
    if (order.buyer._id.toString() !== req.user._id.toString() && 
        order.seller._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to view this order' });
    }

    res.json(order);
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching order',
      error: error.message
    });
  }
});

// Update order status (seller only)
router.patch('/:id/status', authenticateToken, async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Check if user is the seller
    if (order.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only seller can update order status' });
    }

    const validTransitions = {
      'pending': ['requirements_pending', 'in_progress', 'cancelled'],
      'requirements_pending': ['in_progress', 'cancelled'],
      'in_progress': ['delivered', 'cancelled'],
      'delivered': ['completed'],
      'revision_requested': ['in_progress', 'delivered']
    };

    if (!validTransitions[order.status]?.includes(status)) {
      return res.status(400).json({ 
        message: `Cannot transition from ${order.status} to ${status}` 
      });
    }

    order.status = status;
    
    if (status === 'delivered') {
      order.deliveryDate = new Date();
      order.scheduleAutoComplete();
    } else if (status === 'completed') {
      order.completedAt = new Date();
      
      // Update seller earnings and completed orders
      await User.findByIdAndUpdate(order.seller, {
        $inc: { 
          totalEarnings: order.netAmount,
          completedOrders: 1
        }
      });
      
      // Update gig total orders
      await Gig.findByIdAndUpdate(order.gig, {
        $inc: { totalOrders: 1 }
      });
    }

    await order.save();

    // Create notification for buyer
    await createNotification({
      recipient: order.buyer,
      type: `order_${status}`,
      title: `Order ${status}`,
      message: `Your order has been ${status}`,
      data: { orderId: order._id }
    });

    res.json({ message: 'Order status updated successfully', order });
  } catch (error) {
    res.status(500).json({
      message: 'Error updating order status',
      error: error.message
    });
  }
});

// Deliver order
router.post('/:id/deliver', authenticateToken, async (req, res) => {
  try {
    const { message, files = [] } = req.body;
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only seller can deliver order' });
    }

    if (order.status !== 'in_progress') {
      return res.status(400).json({ 
        message: 'Order must be in progress to deliver' 
      });
    }

    order.deliveries.push({
      message,
      files,
      deliveredAt: new Date()
    });

    order.status = 'delivered';
    order.deliveryDate = new Date();
    order.scheduleAutoComplete();

    await order.save();

    // Create notification for buyer
    await createNotification({
      recipient: order.buyer,
      type: 'order_delivered',
      title: 'Order Delivered',
      message: `Your order has been delivered by ${req.user.username}`,
      data: { orderId: order._id }
    });

    res.json({ message: 'Order delivered successfully', order });
  } catch (error) {
    res.status(500).json({
      message: 'Error delivering order',
      error: error.message
    });
  }
});

// Request revision (buyer only)
router.post('/:id/revision', authenticateToken, async (req, res) => {
  try {
    const { message } = req.body;
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.buyer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only buyer can request revision' });
    }

    if (order.status !== 'delivered') {
      return res.status(400).json({ 
        message: 'Can only request revision for delivered orders' 
      });
    }

    // Check if revisions are available
    const usedRevisions = order.revisions.length;
    const availableRevisions = order.packageDetails.revisions;

    if (usedRevisions >= availableRevisions) {
      return res.status(400).json({ 
        message: 'No more revisions available for this package' 
      });
    }

    order.revisions.push({
      message,
      requestedAt: new Date()
    });

    order.status = 'revision_requested';
    await order.save();

    // Create notification for seller
    await createNotification({
      recipient: order.seller,
      type: 'revision_requested',
      title: 'Revision Requested',
      message: `${req.user.username} requested a revision`,
      data: { orderId: order._id }
    });

    res.json({ message: 'Revision requested successfully', order });
  } catch (error) {
    res.status(500).json({
      message: 'Error requesting revision',
      error: error.message
    });
  }
});

// Accept order (buyer only)
router.post('/:id/accept', authenticateToken, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.buyer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only buyer can accept order' });
    }

    if (order.status !== 'delivered') {
      return res.status(400).json({ 
        message: 'Can only accept delivered orders' 
      });
    }

    order.status = 'completed';
    order.completedAt = new Date();

    // Update seller earnings and completed orders
    await User.findByIdAndUpdate(order.seller, {
      $inc: { 
        totalEarnings: order.netAmount,
        completedOrders: 1
      }
    });

    // Update gig total orders
    await Gig.findByIdAndUpdate(order.gig, {
      $inc: { totalOrders: 1 }
    });

    await order.save();

    // Create notification for seller
    await createNotification({
      recipient: order.seller,
      type: 'order_completed',
      title: 'Order Completed',
      message: `${req.user.username} accepted your delivery`,
      data: { orderId: order._id }
    });

    res.json({ message: 'Order accepted successfully', order });
  } catch (error) {
    res.status(500).json({
      message: 'Error accepting order',
      error: error.message
    });
  }
});

// Cancel order
router.post('/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const { reason } = req.body;
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Check if user is authorized to cancel
    const isAuthorized = order.buyer.toString() === req.user._id.toString() || 
                        order.seller.toString() === req.user._id.toString();

    if (!isAuthorized) {
      return res.status(403).json({ message: 'Not authorized to cancel this order' });
    }

    // Check if order can be cancelled
    if (['completed', 'cancelled', 'disputed'].includes(order.status)) {
      return res.status(400).json({ 
        message: 'Cannot cancel order in current status' 
      });
    }

    order.status = 'cancelled';
    order.cancellation = {
      reason,
      requestedBy: req.user._id,
      requestedAt: new Date(),
      approved: true,
      approvedAt: new Date()
    };

    await order.save();

    // Create notification for the other party
    const recipient = order.buyer.toString() === req.user._id.toString() 
      ? order.seller 
      : order.buyer;

    await createNotification({
      recipient,
      type: 'order_cancelled',
      title: 'Order Cancelled',
      message: `Order has been cancelled by ${req.user.username}`,
      data: { orderId: order._id }
    });

    res.json({ message: 'Order cancelled successfully', order });
  } catch (error) {
    res.status(500).json({
      message: 'Error cancelling order',
      error: error.message
    });
  }
});

// Get order analytics (seller only)
router.get('/analytics/dashboard', authenticateToken, async (req, res) => {
  try {
    const sellerId = req.user._id;
    
    const [
      totalOrders,
      activeOrders,
      completedOrders,
      totalEarnings,
      thisMonthOrders,
      thisMonthEarnings
    ] = await Promise.all([
      Order.countDocuments({ seller: sellerId }),
      Order.countDocuments({ seller: sellerId, status: { $in: ['in_progress', 'delivered'] } }),
      Order.countDocuments({ seller: sellerId, status: 'completed' }),
      Order.aggregate([
        { $match: { seller: sellerId, status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$netAmount' } } }
      ]),
      Order.countDocuments({
        seller: sellerId,
        createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) }
      }),
      Order.aggregate([
        {
          $match: {
            seller: sellerId,
            status: 'completed',
            createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) }
          }
        },
        { $group: { _id: null, total: { $sum: '$netAmount' } } }
      ])
    ]);

    res.json({
      totalOrders,
      activeOrders,
      completedOrders,
      totalEarnings: totalEarnings[0]?.total || 0,
      thisMonthOrders,
      thisMonthEarnings: thisMonthEarnings[0]?.total || 0
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching analytics',
      error: error.message
    });
  }
});

export default router;