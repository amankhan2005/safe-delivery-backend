const { push } = require('../services/notificationService');
const { ok, err } = require('../utils/responseHelper');

exports.sendNotification = async (req, res, next) => {
  try {
    const { token, title, body, data } = req.body;

    if (!token || !title || !body) {
      return err(res, 'token, title, and body are required.', 400);
    }

    const result = await push(token, title, body, data || {});

    if (!result) {
      return err(res, 'Failed to send notification. Check the FCM token.', 500);
    }

    return ok(res, { messageId: result }, 'Notification sent successfully.');
  } catch (error) {
    next(error);
  }
};