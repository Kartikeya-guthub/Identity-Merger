const pool = require("../db/connection");
const { normalizeEmail, normalizePhone } = require("../utils/normalize");

async function findMatchingContacts(email, phone) {
  const query = `
    SELECT * FROM contacts
    WHERE (email = $1 OR phone_number = $2)
    AND deleted_at IS NULL
    ORDER BY created_at ASC
  `;
  const { rows } = await pool.query(query, [email, phone]);
  return rows;
}

async function identify(body) {
  const email = normalizeEmail(body.email);
  const phone = normalizePhone(body.phoneNumber);

  const matches = await findMatchingContacts(email, phone);
  return { matches };
}

module.exports = { identify };
