/**
 * Send a success response
 */
export const ok = (
  res,
  data = {},
  message = 'Success',
  statusCode = 200
) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

/**
 * Send an error response
 */
export const err = (
  res,
  message = 'Something went wrong',
  statusCode = 500,
  error = null
) => {
  return res.status(statusCode).json({
    success: false,
    message,
    error: error?.message || null,
  });
};