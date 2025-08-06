import Notification from '../models/Notification.js';
import { emitToUser } from '../socket/socketHandler.js';

export const createNotification = async ({
  recipient,
  sender = null,
  type,
  title,
  message,
  data = {}
}) => {
  try {
    const notification = new Notification({
      recipient,
      sender,
      type,
      title,
      message,
      data
    });

    await notification.save();

    // Populate sender info if exists
    if (sender) {
      await notification.populate('sender', 'username fullName avatar');
    }

    // Emit real-time notification
    emitToUser(recipient, 'new_notification', notification);

    return notification;
  } catch (error) {
    console.error('Error creating notification:', error);
    throw error;
  }
};

export const markNotificationAsRead = async (notificationId, userId) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, recipient: userId },
      { isRead: true, readAt: new Date() },
      { new: true }
    );

    return notification;
  } catch (error) {
    console.error('Error marking notification as read:', error);
    throw error;
  }
};

export const getUnreadNotificationCount = async (userId) => {
  try {
    const count = await Notification.countDocuments({
      recipient: userId,
      isRead: false
    });

    return count;
  } catch (error) {
    console.error('Error getting unread notification count:', error);
    return 0;
  }
};