function normalizeEmail(email) {
  return email ? email.trim().toLowerCase() : null;
}

function normalizePhone(phone) {
  if (!phone) return null;
  return phone.replace(/\D/g, "");
}

module.exports = { normalizeEmail, normalizePhone };
