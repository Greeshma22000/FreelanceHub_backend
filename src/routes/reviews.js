import express from 'express';
import Review from '../models/Review.js';
import Order from '../models/Order.js';
import Gig from '../models/Gig.js';
import User from '../models/User.js';
import { authenticateToken } from '../middleware/auth.js';
import { createNotification } from '../utils/notifications.js';

const router = express.Router();

// Create review
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { orderId, rating, comment, categories } = req.body;
    const reviewerId = req.user._id;

    // Verify order exists and is completed
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.status !== 'completed') {
      return res.status(400).json({ message: 'Can only review completed orders' });
    }

    // Check if user is authorized to review (buyer or seller)
    const isBuyer = order.buyer.toString() === reviewerId.toString();
    const isSeller = order.seller.toString() === reviewerId.toString();

    if (!isBuyer && !isSeller) {
      return res.status(403).json({ message: 'Not authorized to review this order' });
    }

    // Check if already reviewed
    const existingReview = await Review.findOne({ order: orderId, reviewer: reviewerId });
    if (existingReview) {
      return res.status(400).json({ message: 'You have already reviewed this order' });
    }

    // Determine reviewee
    const revieweeId = isBuyer ? order.seller : order.buyer;

    const review = new Review({
      order: orderId,
      gig: order.gig,
      reviewer: reviewerId,
      reviewee: revieweeId,
      rating,
      comment,
      categories
    });

    await review.save();

    // Update order review status
    if (isBuyer) {
      order.isReviewed.buyer = true;
    } else {
      order.isReviewed.seller = true;
    }
    await order.save();

    // Update gig and user ratings
    const gig = await Gig.findById(order.gig);
    const user = await User.findById(revieweeId);

    await Promise.all([
      gig.updateRating(),
      user.updateRating()
    ]);

    // Create notification
    await createNotification({
      recipient: revieweeId,
      sender: reviewerId,
      type: 'review_received',
      title: 'New Review Received',
      message: `You received a ${rating}-star review`,
      data: { 
        orderId,
        reviewId: review._id,
        rating
      }
    });

    // Populate review for response
    await review.populate([
      { path: 'reviewer', select: 'username fullName avatar' },
      { path: 'reviewee', select: 'username fullName avatar' }
    ]);

    res.status(201).json({
      message: 'Review created successfully',
      review
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error creating review',
      error: error.message
    });
  }
});

// Get reviews for a gig
router.get('/gig/:gigId', async (req, res) => {
  try {
    const { page = 1, limit = 10, rating } = req.query;
    const gigId = req.params.gigId;

    let query = { gig: gigId, isPublic: true };
    
    if (rating && rating !== 'all') {
      query.rating = parseInt(rating);
    }

    const reviews = await Review.find(query)
      .populate('reviewer', 'username fullName avatar country memberSince')
      .populate('order', 'package totalAmount')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Review.countDocuments(query);

    // Get rating distribution
    const ratingDistribution = await Review.aggregate([
      { $match: { gig: gigId, isPublic: true } },
      { $group: { _id: '$rating', count: { $sum: 1 } } },
      { $sort: { _id: -1 } }
    ]);

    const distribution = {};
    for (let i = 1; i <= 5; i++) {
      distribution[i] = 0;
    }
    ratingDistribution.forEach(item => {
      distribution[item._id] = item.count;
    });

    res.json({
      reviews,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      ratingDistribution: distribution
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching reviews',
      error: error.message
    });
  }
});

// Get reviews for a user
router.get('/user/:userId', async (req, res) => {
  try {
    const { page = 1, limit = 10, type = 'received' } = req.query;
    const userId = req.params.userId;

    let query = { isPublic: true };
    
    if (type === 'received') {
      query.reviewee = userId;
    } else {
      query.reviewer = userId;
    }

    const reviews = await Review.find(query)
      .populate('reviewer', 'username fullName avatar')
      .populate('reviewee', 'username fullName avatar')
      .populate('gig', 'title images')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Review.countDocuments(query);

    res.json({
      reviews,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching user reviews',
      error: error.message
    });
  }
});

// Respond to review (reviewee only)
router.post('/:id/respond', authenticateToken, async (req, res) => {
  try {
    const { content } = req.body;
    const reviewId = req.params.id;
    const userId = req.user._id;

    const review = await Review.findById(reviewId);
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    if (review.reviewee.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'Only the reviewee can respond to this review' });
    }

    if (review.response.content) {
      return res.status(400).json({ message: 'You have already responded to this review' });
    }

    review.response = {
      content,
      respondedAt: new Date()
    };

    await review.save();

    res.json({
      message: 'Response added successfully',
      review
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error responding to review',
      error: error.message
    });
  }
});

// Report review
router.post('/:id/report', authenticateToken, async (req, res) => {
  try {
    const { reason } = req.body;
    const reviewId = req.params.id;

    const review = await Review.findByIdAndUpdate(
      reviewId,
      { 
        isReported: true,
        reportReason: reason
      },
      { new: true }
    );

    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    res.json({ message: 'Review reported successfully' });
  } catch (error) {
    res.status(500).json({
      message: 'Error reporting review',
      error: error.message
    });
  }
});

// Get review analytics (for gig owner)
router.get('/analytics/gig/:gigId', authenticateToken, async (req, res) => {
  try {
    const gigId = req.params.gigId;
    
    // Verify user owns the gig
    const gig = await Gig.findById(gigId);
    if (!gig || gig.freelancer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const analytics = await Review.aggregate([
      { $match: { gig: gigId, isPublic: true } },
      {
        $group: {
          _id: null,
          totalReviews: { $sum: 1 },
          averageRating: { $avg: '$rating' },
          averageCommunication: { $avg: '$categories.communication' },
          averageServiceAsDescribed: { $avg: '$categories.serviceAsDescribed' },
          averageBuyAgain: { $avg: '$categories.buyAgain' }
        }
      }
    ]);

    const ratingTrend = await Review.aggregate([
      { $match: { gig: gigId, isPublic: true } },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          averageRating: { $avg: '$rating' },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    res.json({
      analytics: analytics[0] || {
        totalReviews: 0,
        averageRating: 0,
        averageCommunication: 0,
        averageServiceAsDescribed: 0,
        averageBuyAgain: 0
      },
      ratingTrend
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching review analytics',
      error: error.message
    });
  }
});

export default router;