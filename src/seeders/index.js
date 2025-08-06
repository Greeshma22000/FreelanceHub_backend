import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';
import Gig from '../models/Gig.js';
import Order from '../models/Order.js';
import Review from '../models/Review.js';

dotenv.config();

const sampleUsers = [
  {
    username: 'john_dev',
    email: 'john@example.com',
    password: 'password123',
    role: 'freelancer',
    fullName: 'John Smith',
    description: 'Full-stack developer with 5+ years of experience in React, Node.js, and MongoDB.',
    skills: ['React', 'Node.js', 'MongoDB', 'JavaScript', 'TypeScript'],
    country: 'United States',
    rating: 4.8,
    totalReviews: 127,
    completedOrders: 150,
    totalEarnings: 25000
  },
  {
    username: 'sarah_design',
    email: 'sarah@example.com',
    password: 'password123',
    role: 'freelancer',
    fullName: 'Sarah Johnson',
    description: 'Creative graphic designer specializing in brand identity and web design.',
    skills: ['Photoshop', 'Illustrator', 'Figma', 'Brand Design', 'Web Design'],
    country: 'Canada',
    rating: 4.9,
    totalReviews: 89,
    completedOrders: 95,
    totalEarnings: 18500
  },
  {
    username: 'mike_client',
    email: 'mike@example.com',
    password: 'password123',
    role: 'client',
    fullName: 'Mike Wilson',
    description: 'Startup founder looking for quality services.',
    country: 'United Kingdom'
  },
  {
    username: 'emma_writer',
    email: 'emma@example.com',
    password: 'password123',
    role: 'freelancer',
    fullName: 'Emma Davis',
    description: 'Professional content writer and copywriter with expertise in SEO and marketing.',
    skills: ['Content Writing', 'Copywriting', 'SEO', 'Marketing', 'Blog Writing'],
    country: 'Australia',
    rating: 4.7,
    totalReviews: 156,
    completedOrders: 180,
    totalEarnings: 22000
  }
];

const sampleGigs = [
  {
    title: 'I will create a modern responsive website using React and Node.js',
    description: 'I will build a professional, modern, and fully responsive website using the latest technologies including React.js for the frontend and Node.js for the backend. The website will be optimized for performance, SEO-friendly, and mobile-responsive.',
    category: 'web-development',
    subcategory: 'Full Stack Development',
    searchTags: ['react', 'nodejs', 'javascript', 'responsive', 'modern'],
    pricing: {
      basic: {
        title: 'Basic Website',
        description: 'Simple 3-page website with responsive design',
        price: 150,
        deliveryTime: 5,
        revisions: 2,
        features: ['Responsive Design', '3 Pages', 'Basic SEO', 'Contact Form']
      },
      standard: {
        title: 'Standard Website',
        description: 'Professional website with CMS and advanced features',
        price: 300,
        deliveryTime: 7,
        revisions: 3,
        features: ['Everything in Basic', 'CMS Integration', 'User Authentication', 'Database Setup', '5 Pages']
      },
      premium: {
        title: 'Premium Website',
        description: 'Complete web application with advanced functionality',
        price: 500,
        deliveryTime: 10,
        revisions: 5,
        features: ['Everything in Standard', 'Payment Integration', 'Admin Dashboard', 'API Development', 'Unlimited Pages']
      }
    },
    images: [
      { url: 'https://images.pexels.com/photos/196644/pexels-photo-196644.jpeg?auto=compress&cs=tinysrgb&w=800' },
      { url: 'https://images.pexels.com/photos/11035380/pexels-photo-11035380.jpeg?auto=compress&cs=tinysrgb&w=800' }
    ],
    rating: 4.8,
    totalReviews: 45,
    totalOrders: 67
  },
  {
    title: 'I will design a professional logo and brand identity package',
    description: 'I will create a unique, professional logo design that perfectly represents your brand. This includes multiple concepts, unlimited revisions, and complete brand identity package with color schemes and typography guidelines.',
    category: 'graphic-design',
    subcategory: 'Logo Design',
    searchTags: ['logo', 'branding', 'design', 'identity', 'professional'],
    pricing: {
      basic: {
        title: 'Logo Only',
        description: 'Professional logo design with 3 concepts',
        price: 50,
        deliveryTime: 3,
        revisions: 3,
        features: ['3 Logo Concepts', 'High Resolution Files', 'Transparent PNG', 'Basic Revisions']
      },
      standard: {
        title: 'Logo + Brand Colors',
        description: 'Logo design with brand color palette and style guide',
        price: 100,
        deliveryTime: 5,
        revisions: 5,
        features: ['Everything in Basic', 'Color Palette', 'Style Guide', 'Social Media Kit', 'Vector Files']
      },
      premium: {
        title: 'Complete Brand Package',
        description: 'Full brand identity with logo, colors, fonts, and guidelines',
        price: 200,
        deliveryTime: 7,
        revisions: 10,
        features: ['Everything in Standard', 'Typography Guide', 'Business Card Design', 'Letterhead Design', 'Brand Guidelines PDF']
      }
    },
    images: [
      { url: 'https://images.pexels.com/photos/196644/pexels-photo-196644.jpeg?auto=compress&cs=tinysrgb&w=800' },
      { url: 'https://images.pexels.com/photos/196644/pexels-photo-196644.jpeg?auto=compress&cs=tinysrgb&w=800' }
    ],
    rating: 4.9,
    totalReviews: 78,
    totalOrders: 89
  }
];

const seedDatabase = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/fiverr-clone');
    console.log('Connected to MongoDB');

    // Clear existing data
    await Promise.all([
      User.deleteMany({}),
      Gig.deleteMany({}),
      Order.deleteMany({}),
      Review.deleteMany({})
    ]);
    console.log('Cleared existing data');

    // Create users
    const users = await User.create(sampleUsers);
    console.log('Created sample users');

    // Create gigs
    const freelancers = users.filter(user => user.role === 'freelancer');
    const gigsWithFreelancers = sampleGigs.map((gig, index) => ({
      ...gig,
      freelancer: freelancers[index % freelancers.length]._id
    }));

    const gigs = await Gig.create(gigsWithFreelancers);
    console.log('Created sample gigs');

    // Create some sample orders
    const client = users.find(user => user.role === 'client');
    const sampleOrders = [
      {
        buyer: client._id,
        seller: freelancers[0]._id,
        gig: gigs[0]._id,
        package: 'basic',
        packageDetails: gigs[0].pricing.basic,
        totalAmount: gigs[0].pricing.basic.price + 10,
        serviceFee: 10,
        netAmount: gigs[0].pricing.basic.price * 0.8,
        status: 'completed',
        paymentStatus: 'paid',
        paymentIntentId: 'pi_sample_123',
        completedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      }
    ];

    const orders = await Order.create(sampleOrders);
    console.log('Created sample orders');

    // Create sample reviews
    const sampleReviews = [
      {
        order: orders[0]._id,
        gig: gigs[0]._id,
        reviewer: client._id,
        reviewee: freelancers[0]._id,
        rating: 5,
        comment: 'Excellent work! The website looks amazing and works perfectly. Highly recommended!',
        categories: {
          communication: 5,
          serviceAsDescribed: 5,
          buyAgain: 5
        }
      }
    ];

    await Review.create(sampleReviews);
    console.log('Created sample reviews');

    console.log('✅ Database seeded successfully!');
    console.log('\nSample accounts:');
    console.log('Freelancer: john@example.com / password123');
    console.log('Freelancer: sarah@example.com / password123');
    console.log('Client: mike@example.com / password123');
    console.log('Freelancer: emma@example.com / password123');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }
};

seedDatabase();