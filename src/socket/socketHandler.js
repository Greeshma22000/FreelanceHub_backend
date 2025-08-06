import jwt from 'jsonwebtoken';
import User from '../models/User.js';

let io;

export const setupSocket = (socketIO) => {
  io = socketIO;

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).select('-password');
      
      if (!user) {
        return next(new Error('User not found'));
      }

      socket.userId = user._id.toString();
      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`User ${socket.user.username} connected`);

    // Join user to their personal room
    socket.join(`user_${socket.userId}`);

    // Update user online status
    User.findByIdAndUpdate(socket.userId, {
      isOnline: true,
      lastSeen: new Date()
    }).exec();

    // Handle joining conversation rooms
    socket.on('join_conversation', (conversationId) => {
      socket.join(`conversation_${conversationId}`);
      console.log(`User ${socket.user.username} joined conversation ${conversationId}`);
    });

    // Handle leaving conversation rooms
    socket.on('leave_conversation', (conversationId) => {
      socket.leave(`conversation_${conversationId}`);
      console.log(`User ${socket.user.username} left conversation ${conversationId}`);
    });

    // Handle typing indicators
    socket.on('typing_start', ({ conversationId, receiverId }) => {
      socket.to(`user_${receiverId}`).emit('user_typing', {
        conversationId,
        userId: socket.userId,
        username: socket.user.username
      });
    });

    socket.on('typing_stop', ({ conversationId, receiverId }) => {
      socket.to(`user_${receiverId}`).emit('user_stopped_typing', {
        conversationId,
        userId: socket.userId
      });
    });

    // Handle order updates
    socket.on('join_order_room', (orderId) => {
      socket.join(`order_${orderId}`);
    });

    socket.on('leave_order_room', (orderId) => {
      socket.leave(`order_${orderId}`);
    });

    // Handle notifications
    socket.on('mark_notification_read', async (notificationId) => {
      try {
        const Notification = (await import('../models/Notification.js')).default;
        await Notification.findByIdAndUpdate(notificationId, {
          isRead: true,
          readAt: new Date()
        });
      } catch (error) {
        console.error('Error marking notification as read:', error);
      }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log(`User ${socket.user.username} disconnected`);
      
      // Update user offline status
      User.findByIdAndUpdate(socket.userId, {
        isOnline: false,
        lastSeen: new Date()
      }).exec();
    });
  });
};

export const getIO = () => {
  if (!io) {
    throw new Error('Socket.IO not initialized');
  }
  return io;
};

// Utility functions for emitting events
export const emitToUser = (userId, event, data) => {
  if (io) {
    io.to(`user_${userId}`).emit(event, data);
  }
};

export const emitToConversation = (conversationId, event, data) => {
  if (io) {
    io.to(`conversation_${conversationId}`).emit(event, data);
  }
};

export const emitToOrder = (orderId, event, data) => {
  if (io) {
    io.to(`order_${orderId}`).emit(event, data);
  }
};