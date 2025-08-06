import mongoose from 'mongoose';

const gigSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    required: true,
    maxlength: 2000
  },
  category: {
    type: String,
    required: true,
    enum: [
      'web-development',
      'mobile-development', 
      'graphic-design',
      'digital-marketing',
      'writing-translation',
      'video-animation',
      'music-audio',
      'programming-tech',
      'business',
      'lifestyle'
    ]
  },
  subcategory: {
    type: String,
    required: true
  },
  searchTags: [{
    type: String,
    trim: true
  }],
  pricing: {
    basic: {
      title: {
        type: String,
        required: true
      },
      description: {
        type: String,
        required: true
      },
      price: {
        type: Number,
        required: true,
        min: 5
      },
      deliveryTime: {
        type: Number,
        required: true,
        min: 1
      },
      revisions: {
        type: Number,
        required: true,
        min: 0
      },
      features: [String]
    },
    standard: {
      title: String,
      description: String,
      price: {
        type: Number,
        min: 5
      },
      deliveryTime: {
        type: Number,
        min: 1
      },
      revisions: {
        type: Number,
        min: 0
      },
      features: [String]
    },
    premium: {
      title: String,
      description: String,
      price: {
        type: Number,
        min: 5
      },
      deliveryTime: {
        type: Number,
        min: 1
      },
      revisions: {
        type: Number,
        min: 0
      },
      features: [String]
    }
  },
  images: [{
    url: {
      type: String,
      required: true
    },
    publicId: String
  }],
  video: {
    url: String,
    publicId: String
  },
  freelancer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  totalReviews: {
    type: Number,
    default: 0
  },
  totalOrders: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isPaused: {
    type: Boolean,
    default: false
  },
  impressions: {
    type: Number,
    default: 0
  },
  clicks: {
    type: Number,
    default: 0
  },
  favorites: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  faqs: [{
    question: String,
    answer: String
  }],
  requirements: [{
    question: String,
    type: {
      type: String,
      enum: ['text', 'multiple-choice', 'file'],
      default: 'text'
    },
    required: {
      type: Boolean,
      default: false
    },
    options: [String] // For multiple choice
  }]
}, {
  timestamps: true
});

// Indexes for search and filtering
gigSchema.index({ title: 'text', description: 'text', searchTags: 'text' });
gigSchema.index({ category: 1 });
gigSchema.index({ subcategory: 1 });
gigSchema.index({ freelancer: 1 });
gigSchema.index({ rating: -1 });
gigSchema.index({ totalOrders: -1 });
gigSchema.index({ 'pricing.basic.price': 1 });
gigSchema.index({ createdAt: -1 });
gigSchema.index({ isActive: 1, isPaused: 1 });

// Update rating method
gigSchema.methods.updateRating = async function() {
  const Review = mongoose.model('Review');
  const reviews = await Review.find({ gig: this._id });
  
  if (reviews.length > 0) {
    const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0);
    this.rating = totalRating / reviews.length;
    this.totalReviews = reviews.length;
  } else {
    this.rating = 0;
    this.totalReviews = 0;
  }
  
  await this.save();
};

export default mongoose.model('Gig', gigSchema);