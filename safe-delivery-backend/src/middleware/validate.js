const { err } = require('../utils/responseHelper');

const validateSignup = (req, res, next) => {
  const { name, phone, email, password } = req.body;
  const missing = [];

  if (!name || !name.trim()) missing.push('name');
  if (!phone || !phone.trim()) missing.push('phone');
  if (!email || !email.trim()) missing.push('email');
  if (!password) missing.push('password');

  if (missing.length > 0) {
    return err(res, `Missing required fields: ${missing.join(', ')}.`, 400);
  }

  if (password.length < 6) {
    return err(res, 'Password must be at least 6 characters long.', 400);
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return err(res, 'Please provide a valid email address.', 400);
  }

  next();
};

const validateLogin = (req, res, next) => {
  const { identifier, password } = req.body;

  if (!identifier || !identifier.trim()) {
    return err(res, 'Phone number or email is required.', 400);
  }

  if (!password) {
    return err(res, 'Password is required.', 400);
  }

  next();
};

const validateOrder = (req, res, next) => {
  const { pickup, drop, parcelWeight } = req.body;
  const validWeights = ['<1lb', '1-5lb', '5-10lb', '>10lb'];

  if (!pickup) return err(res, 'Pickup details are required.', 400);
  if (!drop) return err(res, 'Drop details are required.', 400);

  const pickupFields = ['address', 'lat', 'lng', 'contactName', 'contactPhone'];
  for (const field of pickupFields) {
    if (pickup[field] === undefined || pickup[field] === null || pickup[field] === '') {
      return err(res, `Pickup ${field} is required.`, 400);
    }
  }

  const dropFields = ['address', 'lat', 'lng', 'contactName', 'contactPhone'];
  for (const field of dropFields) {
    if (drop[field] === undefined || drop[field] === null || drop[field] === '') {
      return err(res, `Drop ${field} is required.`, 400);
    }
  }

  if (!parcelWeight || !validWeights.includes(parcelWeight)) {
    return err(res, `parcelWeight must be one of: ${validWeights.join(', ')}.`, 400);
  }

  next();
};

module.exports = { validateSignup, validateLogin, validateOrder };