import express from 'express';
import Gig from '../models/Gig.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// Get all gigs with filters
router.get('/', async (req, res) => {
  try {
    const { category, search, minPrice, maxPrice, page = 1, limit = 12 } = req.query;
    
    let query = { isActive: true };
    
    // Category filter
    if (category && category !== 'all') {
      query.category = category;
    }
    
    // Search filter
    if (search) {
      query.$text = { $search: search };
    }
    
    // Price filter
    if (minPrice || maxPrice) {
      query['price.basic.price'] = {};
      if (minPrice) query['price.basic.price'].$gte = Number(minPrice);
      if (maxPrice) query['price.basic.price'].$lte = Number(maxPrice);
    }

    const skip = (Number(page) - 1) * Number(limit);
    
    const gigs = await Gig.find(query)
      .populate('freelancer', 'username fullName avatar rating totalReviews')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    const total = await Gig.countDocuments(query);
    
    res.json({
      gigs,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching gigs',
      error: error.message
    });
  }
});

// Get single gig
router.get('/:id', async (req, res) => {
  try {
    const gig = await Gig.findById(req.params.id)
      .populate('freelancer', 'username fullName avatar rating totalReviews description isOnline');
    
    if (!gig) {
      return res.status(404).json({ message: 'Gig not found' });
    }
    
    res.json(gig);
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching gig',
      error: error.message
    });
  }
});

// Create new gig (freelancers only)
router.post('/', authenticateToken, requireRole(['freelancer']), async (req, res) => {
  try {
    const gigData = {
      ...req.body,
      freelancer: req.user._id,
      price: req.body.pricing ? {
        basic: req.body.pricing.basic
      } : undefined
    };

    if(!gigData.title || !gigData.description || !gigData.category) {
      return res.status(400).json({message: 'Missing required fields'});
    }
    
    const gig = new Gig(gigData);
    await gig.save();
    
    const populatedGig = await Gig.findById(gig._id)
      .populate('freelancer', 'username fullName avatar rating totalReviews');
    
    res.status(201).json({
      message: 'Gig created successfully',
      gig: populatedGig
    });
  } catch (error) {
    console.error('Detailed error:', error);
    res.status(500).json({
      message: 'Error creating gig',
      error: error.message,
      ...(error.name === 'ValidationError' && {errors: error.errors})
    });
  }
});

// Update gig (freelancer only, own gigs)
router.put('/:id', authenticateToken, requireRole(['freelancer']), async (req, res) => {
  try {
    const gig = await Gig.findById(req.params.id);
    
    if (!gig) {
      return res.status(404).json({ message: 'Gig not found' });
    }
    
    // Check if user owns the gig
    if (gig.freelancer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to update this gig' });
    }
    
    const updatedGig = await Gig.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('freelancer', 'username fullName avatar rating totalReviews');
    
    res.json({
      message: 'Gig updated successfully',
      gig: updatedGig
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error updating gig',
      error: error.message
    });
  }
});

// Delete gig (freelancer only, own gigs)
router.delete('/:id', authenticateToken, requireRole(['freelancer']), async (req, res) => {
  try {
    const gig = await Gig.findById(req.params.id);
    
    if (!gig) {
      return res.status(404).json({ message: 'Gig not found' });
    }
    
    // Check if user owns the gig
    if (gig.freelancer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to delete this gig' });
    }
    
    await Gig.findByIdAndDelete(req.params.id);
    
    res.json({ message: 'Gig deleted successfully' });
  } catch (error) {
    res.status(500).json({
      message: 'Error deleting gig',
      error: error.message
    });
  }
});

// Get user's gigs (freelancer only)
router.get('/user/my-gigs', authenticateToken, requireRole(['freelancer']), async (req, res) => {
  try {
    const gigs = await Gig.find({ freelancer: req.user._id })
      .sort({ createdAt: -1 });
    
    res.json(gigs);
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching user gigs',
      error: error.message
    });
  }
});

export default router;