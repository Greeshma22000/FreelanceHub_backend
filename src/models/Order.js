import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema({
  buyer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  gig: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Gig',
    required: true
  },
  package: {
    type: String,
    enum: ['basic', 'standard', 'premium'],
    required: true
  },
  packageDetails: {
    title: String,
    description: String,
    price: Number,
    deliveryTime: Number,
    revisions: Number,
    features: [String]
  },
  customRequirements: [{
    question: String,
    answer: String,
    type: String
  }],
  totalAmount: {
    type: Number,
    required: true
  },
  serviceFee: {
    type: Number,
    required: true
  },
  netAmount: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: [
      'pending',
      'requirements_pending',
      'in_progress',
      'delivered',
      'revision_requested',
      'completed',
      'cancelled',
      'disputed'
    ],
    default: 'pending'
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'refunded', 'failed'],
    default: 'pending'
  },
  paymentIntentId: {
    type: String,
    required: true
  },
  stripeSessionId: String,
  deliveryDate: Date,
  completedAt: Date,
  deliveries: [{
    message: String,
    files: [{
      name: String,
      url: String,
      size: Number,
      type: String
    }],
    deliveredAt: {
      type: Date,
      default: Date.now
    }
  }],
  revisions: [{
    message: String,
    requestedAt: {
      type: Date,
      default: Date.now
    },
    response: String,
    respondedAt: Date
  }],
  cancellation: {
    reason: String,
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    requestedAt: Date,
    approved: Boolean,
    approvedAt: Date
  },
  dispute: {
    reason: String,
    description: String,
    raisedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    raisedAt: Date,
    status: {
      type: String,
      enum: ['open', 'resolved', 'closed']
    },
    resolution: String,
    resolvedAt: Date
  },
  isReviewed: {
    buyer: {
      type: Boolean,
      default: false
    },
    seller: {
      type: Boolean,
      default: false
    }
  },
  autoCompleteAt: Date
}, {
  timestamps: true
});

// Indexes
orderSchema.index({ buyer: 1 });
orderSchema.index({ seller: 1 });
orderSchema.index({ gig: 1 });
orderSchema.index({ status: 1 });
orderSchema.index({ paymentStatus: 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ deliveryDate: 1 });

// Auto-complete orders after 3 days of delivery
orderSchema.methods.scheduleAutoComplete = function() {
  if (this.status === 'delivered' && !this.autoCompleteAt) {
    this.autoCompleteAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days
    return this.save();
  }
};

export default mongoose.model('Order', orderSchema);