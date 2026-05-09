const TEMP_EXPIRY_MS = 10 * 60 * 1000;

const store = new Map();

export const saveTempSignup = (phone, email, data, type = 'user') => {
  const expiresAt = Date.now() + TEMP_EXPIRY_MS;
  const entry = { data: { ...data }, expiresAt, type };
  store.set(phone, entry);
  store.set(email.toLowerCase(), entry);
};

export const getTempSignup = (identifier) => {
  const entry = store.get(identifier);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(identifier);
    return null;
  }
  return entry;
};

export const deleteTempSignup = (phone, email) => {
  store.delete(phone);
  if (email) store.delete(email.toLowerCase());
};

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.expiresAt) store.delete(key);
  }
}, 5 * 60 * 1000);