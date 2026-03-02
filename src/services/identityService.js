const pool = require("../db/connection");
const { normalizeEmail, normalizePhone } = require("../utils/normalize");

async function getFullGroup(client, email, phone) {
  const initial = await client.query(
    `SELECT * FROM contacts
     WHERE (email = $1 OR phone_number = $2)
     AND deleted_at IS NULL`,
    [email, phone]
  );

  if (initial.rows.length === 0) return [];

  let contacts = initial.rows;

  const emails = contacts.map((c) => c.email).filter(Boolean);
  const phones = contacts.map((c) => c.phone_number).filter(Boolean);

  const expanded = await client.query(
    `SELECT * FROM contacts
     WHERE (email = ANY($1) OR phone_number = ANY($2))
     AND deleted_at IS NULL`,
    [emails, phones]
  );

  return expanded.rows;
}

async function identify(body) {
  const email = normalizeEmail(body.email);
  const phone = normalizePhone(body.phoneNumber);

  const client = await pool.connect();
  try {
    const group = await getFullGroup(client, email, phone);
    return { group };
  } finally {
    client.release();
  }
}

module.exports = { identify };
