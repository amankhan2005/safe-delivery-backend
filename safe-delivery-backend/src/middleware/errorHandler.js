const errorHandler = (error, req, res, next) => {
  console.error('Error:', error);

  // Mongoose duplicate key
  if (error.code === 11000) {
    const field = Object.keys(error.keyValue || {})[0] || 'field';
    const value = error.keyValue ? error.keyValue[field] : '';
    return res.status(400).json({
      success: false,
      error: `${field.charAt(0).toUpperCase() + field.slice(1)} '${value}' is already in use.`,
    });
  }

  // Mongoose validation errors
  if (error.name === 'ValidationError') {
    const messages = Object.values(error.errors).map((e) => e.message);
    return res.status(400).json({
      success: false,
      error: messages.join('. '),
    });
  }

  // Mongoose bad ObjectId
  if (error.name === 'CastError') {
    return res.status(400).json({
      success: false,
      error: `Invalid ${error.path}: ${error.value}`,
    });
  }

  // JWT errors
  if (error.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      error: 'Invalid token.',
    });
  }

  if (error.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      error: 'Token expired. Please log in again.',
    });
  }

  // Multer file size error
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      error: 'File size too large. Maximum allowed is 5MB.',
    });
  }

  // Multer unexpected field
  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      success: false,
      error: `Unexpected file field: ${error.field}`,
    });
  }

  // Default error
  return res.status(error.statusCode || 500).json({
    success: false,
    error: error.message || 'Internal server error.',
  });
};

module.exports = errorHandler;