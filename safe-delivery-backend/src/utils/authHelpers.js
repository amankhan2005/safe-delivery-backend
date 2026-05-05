import User from '../models/userModel.js';
import Rider from '../models/riderModel.js';
import { normalizePhone } from './phoneNormalizer.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isEmail = (identifier) => EMAIL_REGEX.test(identifier.trim());

export const findUserByIdentifier = async (identifier, withPassword = false) => {
  const trimmed = identifier.trim();
  const query = isEmail(trimmed)
    ? { email: trimmed.toLowerCase() }
    : { phone: normalizePhone(trimmed) };
  return withPassword
    ? User.findOne(query).select('+password')
    : User.findOne(query);
};

export const findRiderByIdentifier = async (identifier, withPassword = false) => {
  const trimmed = identifier.trim();
  const query = isEmail(trimmed)
    ? { email: trimmed.toLowerCase() }
    : { phone: normalizePhone(trimmed) };
  return withPassword
    ? Rider.findOne(query).select('+password')
    : Rider.findOne(query);
};