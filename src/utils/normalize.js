function normalizeEmail(email) {
  return email ? email.trim().toLowerCase() : null;
}

function normalizePhone(phone) {
  return phone ? phone.trim() : null;
}

module.exports = { normalizeEmail, normalizePhone };
