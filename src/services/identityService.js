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

function findPrimary(contacts) {
  let primary = contacts[0];

  for (const c of contacts) {
    if (new Date(c.created_at) < new Date(primary.created_at)) {
      primary = c;
    }
  }

  return primary;
}

async function mergePrimaries(client, contacts, primaryId) {
  for (const c of contacts) {
    if (c.link_precedence === "primary" && c.id !== primaryId) {
      await client.query(
        `UPDATE contacts
         SET link_precedence='secondary', linked_id=$1, updated_at=now()
         WHERE id=$2`,
        [primaryId, c.id]
      );
    }
  }
}

function hasNewInfo(contacts, email, phone) {
  const emails = contacts.map((c) => c.email);
  const phones = contacts.map((c) => c.phone_number);

  return (
    (email && !emails.includes(email)) ||
    (phone && !phones.includes(phone))
  );
}

async function identify(body) {
  const email = normalizeEmail(body.email);
  const phone = normalizePhone(body.phoneNumber);

  const client = await pool.connect();
  try {
    let group = await getFullGroup(client, email, phone);

    if (group.length === 0) {
      // Brand new contact — insert as primary
      await client.query(
        `INSERT INTO contacts (email, phone_number, link_precedence)
         VALUES ($1, $2, 'primary')`,
        [email, phone]
      );
      group = await getFullGroup(client, email, phone);
      const primary = findPrimary(group);
      return { group, primaryId: primary.id };
    }

    const primary = findPrimary(group);
    await mergePrimaries(client, group, primary.id);

    if (hasNewInfo(group, email, phone)) {
      await client.query(
        `INSERT INTO contacts (email, phone_number, linked_id, link_precedence)
         VALUES ($1, $2, $3, 'secondary')`,
        [email, phone, primary.id]
      );
    }

    group = await getFullGroup(client, email, phone);
    return { group, primaryId: primary.id };
  } finally {
    client.release();
  }
}

module.exports = { identify };
