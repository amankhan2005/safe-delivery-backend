const errorHandler = (error, req, res, next) => {
  if (res.headersSent) return next(error);

  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    console.error('[ErrorHandler]', error.name, error.message);
  } else if (!error.statusCode || error.statusCode >= 500) {
    console.error('[ErrorHandler 5xx]', error.message);
  }

  if (error.code === 11000) {
    const field = Object.keys(error.keyValue || {})[0] || 'field';
    const value = error.keyValue?.[field] ?? '';
    return res.status(400).json({ success: false, error: `${field.charAt(0).toUpperCase() + field.slice(1)} '${value}' is already in use.` });
  }

  if (error.name === 'ValidationError') {
    const messages = Object.values(error.errors).map((e) => e.message);
    return res.status(400).json({ success: false, error: messages.join('. ') });
  }

  if (error.name === 'CastError') {
    return res.status(400).json({ success: false, error: `Invalid ${error.path}: ${error.value}` });
  }

  if (error.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, error: 'Invalid token. Please log in again.' });
  }

  if (error.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, error: 'Session expired. Please log in again.' });
  }

  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, error: 'File too large. Maximum 8MB allowed.' });
  }

  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ success: false, error: `Unexpected file field: ${error.field}. Check field names.` });
  }

  if (error.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({ success: false, error: 'Too many files uploaded.' });
  }

  if (error.http_code) {
    return res.status(500).json({ success: false, error: error.message || 'Photo upload failed. Please try again.' });
  }

  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return res.status(504).json({ success: false, error: 'Request timed out. Please try again.' });
  }

  if (error.statusCode) {
    return res.status(error.statusCode).json({ success: false, error: error.message || 'An error occurred.' });
  }

  return res.status(500).json({
    success: false,
    error: isProd ? 'Internal server error.' : (error.message || 'Internal server error.'),
  });
};

export default errorHandler;