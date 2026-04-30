import jwt from 'jsonwebtoken';
import User from '../models/userModel.js';
import Rider from '../models/riderModel.js';
import { err } from '../utils/responseHelper.js';

/**
 * Protect middleware — verify JWT and attach user/rider to req.
 */
export const protect = async (req, res, next) => {
  try {
    let token;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer ')
    ) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return err(res, 'Access denied. No token provided.', 401);
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role === 'rider') {
      const rider = await Rider.findById(decoded.id);
      if (!rider) return err(res, 'Rider not found.', 401);

      req.user = rider;
      req.role = 'rider';
    } else {
      const user = await User.findById(decoded.id);
      if (!user) return err(res, 'User not found.', 401);

      req.user = user;
      req.role = decoded.role || 'customer';
    }

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return err(res, 'Invalid token.', 401);
    }
    if (error.name === 'TokenExpiredError') {
      return err(res, 'Token expired. Please log in again.', 401);
    }
    next(error);
  }
};

export const isAdmin = (req, res, next) => {
  if (req.role !== 'admin') {
    return err(res, 'Access denied. Admins only.', 403);
  }
  next();
};

export const isRider = (req, res, next) => {
  if (req.role !== 'rider') {
    return err(res, 'Access denied. Riders only.', 403);
  }
  next();
};

export const isCustomer = (req, res, next) => {
  if (req.role !== 'customer') {
    return err(res, 'Access denied. Customers only.', 403);
  }
  next();
};