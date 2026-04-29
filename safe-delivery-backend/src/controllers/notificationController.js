const { push } = require('../services/notificationService');
const { ok, err } = require('../utils/responseHelper');

exports.sendNotification = async (req, res, next) => {
  try {
    const { data } = req.body;
    const token = typeof req.body.token === 'string' ? req.body.token.trim() : null;
    const title = typeof req.body.title === 'string' ? req.body.title.trim() : null;
    const body  = typeof req.body.body  === 'string' ? req.body.body.trim()  : null;

    if (!token)  return err(res, 'token is required and must be a non-empty string.', 400);
    if (!title)  return err(res, 'title is required and must be a non-empty string.', 400);
    if (!body)   return err(res, 'body is required and must be a non-empty string.', 400);

    // data must be a plain object if provided
    if (data !== undefined && (typeof data !== 'object' || Array.isArray(data) || data === null)) {
      return err(res, 'data must be a plain object (key-value pairs).', 400);
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