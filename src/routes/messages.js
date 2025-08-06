import express from 'express';
import Message from '../models/Message.js';
import Conversation from '../models/Conversation.js';
import { authenticateToken } from '../middleware/auth.js';
import { getIO } from '../socket/socketHandler.js';

const router = express.Router();

// Get user conversations
router.get('/conversations', authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id;
    
    const conversations = await Conversation.find({
      participants: userId
    })
    .populate('participants', 'username fullName avatar isOnline lastSeen')
    .populate('lastMessage')
    .populate('gig', 'title images')
    .populate('order', 'status totalAmount')
    .sort({ lastActivity: -1 });

    // Add unread count for current user
    const conversationsWithUnread = conversations.map(conv => {
      const unreadCount = conv.unreadCount.get(userId.toString()) || 0;
      return {
        ...conv.toObject(),
        unreadCount
      };
    });

    res.json(conversationsWithUnread);
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching conversations',
      error: error.message
    });
  }
});

// Get or create conversation
router.post('/conversations', authenticateToken, async (req, res) => {
  try {
    const { participantId, gigId, orderId } = req.body;
    const userId = req.user._id;

    if (userId.toString() === participantId) {
      return res.status(400).json({ message: 'Cannot create conversation with yourself' });
    }

    // Check if conversation already exists
    let conversation = await Conversation.findOne({
      participants: { $all: [userId, participantId] }
    })
    .populate('participants', 'username fullName avatar isOnline lastSeen')
    .populate('lastMessage')
    .populate('gig', 'title images')
    .populate('order', 'status totalAmount');

    if (!conversation) {
      // Create new conversation
      conversation = new Conversation({
        participants: [userId, participantId],
        gig: gigId || undefined,
        order: orderId || undefined
      });

      await conversation.save();
      
      conversation = await Conversation.findById(conversation._id)
        .populate('participants', 'username fullName avatar isOnline lastSeen')
        .populate('gig', 'title images')
        .populate('order', 'status totalAmount');
    }

    res.json(conversation);
  } catch (error) {
    res.status(500).json({
      message: 'Error creating conversation',
      error: error.message
    });
  }
});

// Get messages in conversation
router.get('/conversations/:id/messages', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const conversationId = req.params.id;
    const userId = req.user._id;

    // Verify user is participant
    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      return res.status(403).json({ message: 'Not authorized to view this conversation' });
    }

    const messages = await Message.find({ 
      conversation: conversationId,
      isDeleted: false
    })
    .populate('sender', 'username fullName avatar')
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

    // Mark messages as read
    await Message.updateMany(
      { 
        conversation: conversationId, 
        receiver: userId, 
        isRead: false 
      },
      { 
        isRead: true, 
        readAt: new Date() 
      }
    );

    // Update conversation unread count
    conversation.unreadCount.set(userId.toString(), 0);
    await conversation.save();

    res.json(messages.reverse());
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching messages',
      error: error.message
    });
  }
});

// Send message
router.post('/conversations/:id/messages', authenticateToken, async (req, res) => {
  try {
    const { content, messageType = 'text', attachments = [], customOffer } = req.body;
    const conversationId = req.params.id;
    const senderId = req.user._id;

    // Verify conversation exists and user is participant
    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !conversation.participants.includes(senderId)) {
      return res.status(403).json({ message: 'Not authorized to send message to this conversation' });
    }

    const receiverId = conversation.participants.find(p => p.toString() !== senderId.toString());

    const message = new Message({
      conversation: conversationId,
      sender: senderId,
      receiver: receiverId,
      content,
      messageType,
      attachments,
      customOffer
    });

    await message.save();

    // Update conversation
    conversation.lastMessage = message._id;
    conversation.lastActivity = new Date();
    
    // Update unread count for receiver
    const currentUnread = conversation.unreadCount.get(receiverId.toString()) || 0;
    conversation.unreadCount.set(receiverId.toString(), currentUnread + 1);
    
    await conversation.save();

    // Populate message for response
    await message.populate('sender', 'username fullName avatar');

    // Emit to receiver via Socket.IO
    const io = getIO();
    io.to(`user_${receiverId}`).emit('new_message', {
      message,
      conversationId
    });

    res.status(201).json(message);
  } catch (error) {
    res.status(500).json({
      message: 'Error sending message',
      error: error.message
    });
  }
});

// Mark message as read
router.patch('/messages/:id/read', authenticateToken, async (req, res) => {
  try {
    const messageId = req.params.id;
    const userId = req.user._id;

    const message = await Message.findOneAndUpdate(
      { _id: messageId, receiver: userId, isRead: false },
      { isRead: true, readAt: new Date() },
      { new: true }
    );

    if (!message) {
      return res.status(404).json({ message: 'Message not found or already read' });
    }

    // Update conversation unread count
    const conversation = await Conversation.findById(message.conversation);
    const currentUnread = conversation.unreadCount.get(userId.toString()) || 0;
    conversation.unreadCount.set(userId.toString(), Math.max(0, currentUnread - 1));
    await conversation.save();

    // Emit read receipt via Socket.IO
    const io = getIO();
    io.to(`user_${message.sender}`).emit('message_read', {
      messageId,
      readAt: message.readAt
    });

    res.json({ message: 'Message marked as read' });
  } catch (error) {
    res.status(500).json({
      message: 'Error marking message as read',
      error: error.message
    });
  }
});

// Accept custom offer
router.post('/messages/:id/accept-offer', authenticateToken, async (req, res) => {
  try {
    const messageId = req.params.id;
    const userId = req.user._id;

    const message = await Message.findById(messageId);
    if (!message || message.receiver.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (message.messageType !== 'custom_offer' || !message.customOffer) {
      return res.status(400).json({ message: 'Not a custom offer message' });
    }

    if (message.customOffer.status !== 'pending') {
      return res.status(400).json({ message: 'Offer is no longer available' });
    }

    message.customOffer.status = 'accepted';
    await message.save();

    // Here you would typically create a Stripe checkout session
    // and redirect to payment

    res.json({ message: 'Offer accepted', redirectUrl: '/checkout' });
  } catch (error) {
    res.status(500).json({
      message: 'Error accepting offer',
      error: error.message
    });
  }
});

// Get unread message count
router.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id;
    
    const conversations = await Conversation.find({
      participants: userId
    });

    const totalUnread = conversations.reduce((total, conv) => {
      return total + (conv.unreadCount.get(userId.toString()) || 0);
    }, 0);

    res.json({ unreadCount: totalUnread });
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching unread count',
      error: error.message
    });
  }
});

export default router;