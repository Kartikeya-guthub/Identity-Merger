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

function buildResponse(contacts, primary) {
  // Ensure primary email/phone comes first
  const primaryEmail = primary.email;
  const primaryPhone = primary.phone_number;

  const otherEmails = contacts
    .map((c) => c.email)
    .filter((e) => e && e !== primaryEmail);
  const otherPhones = contacts
    .map((c) => c.phone_number)
    .filter((p) => p && p !== primaryPhone);

  const emails = [...new Set([primaryEmail, ...otherEmails].filter(Boolean))];
  const phones = [...new Set([primaryPhone, ...otherPhones].filter(Boolean))];

  const secondaryIds = contacts
    .filter((c) => c.link_precedence === "secondary")
    .map((c) => c.id);

  return {
    contact: {
      primaryContactId: primary.id,
      emails,
      phoneNumbers: phones,
      secondaryContactIds: secondaryIds,
    },
  };
}

async function identify(body) {
  const email = normalizeEmail(body.email);
  const phone = normalizePhone(body.phoneNumber);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    let contacts = await getFullGroup(client, email, phone);

    if (contacts.length === 0) {
      const res = await client.query(
        `INSERT INTO contacts (email, phone_number, link_precedence)
         VALUES ($1, $2, 'primary')
         RETURNING *`,
        [email, phone]
      );

      await client.query("COMMIT");
      return buildResponse([res.rows[0]], res.rows[0]);
    }

    const primary = findPrimary(contacts);

    await mergePrimaries(client, contacts, primary.id);

    if (hasNewInfo(contacts, email, phone)) {
      await client.query(
        `INSERT INTO contacts (email, phone_number, linked_id, link_precedence)
         VALUES ($1, $2, $3, 'secondary')`,
        [email, phone, primary.id]
      );
    }

    contacts = await getFullGroup(client, email, phone);

    await client.query("COMMIT");

    return buildResponse(contacts, primary);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { identify };
