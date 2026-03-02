const pool = require("../db/connection");
const { normalizeEmail, normalizePhone } = require("../utils/normalize");

async function getFullGroup(client, email, phone) {
  const conditions = [];
  const params = [];

  if (email) {
    params.push(email);
    conditions.push(`email = $${params.length}`);
  }
  if (phone) {
    params.push(phone);
    conditions.push(`phone_number = $${params.length}`);
  }

  if (conditions.length === 0) return [];

  const initial = await client.query(
    `SELECT * FROM contacts
     WHERE (${conditions.join(" OR ")})
     AND deleted_at IS NULL`,
    params
  );

  if (initial.rows.length === 0) return [];

  let contacts = initial.rows;

  const emails = contacts.map((c) => c.email).filter(Boolean);
  const phones = contacts.map((c) => c.phone_number).filter(Boolean);

  if (emails.length === 0 && phones.length === 0) return contacts;

  const expandConditions = [];
  const expandParams = [];

  if (emails.length > 0) {
    expandParams.push(emails);
    expandConditions.push(`email = ANY($${expandParams.length})`);
  }
  if (phones.length > 0) {
    expandParams.push(phones);
    expandConditions.push(`phone_number = ANY($${expandParams.length})`);
  }

  const expanded = await client.query(
    `SELECT * FROM contacts
     WHERE (${expandConditions.join(" OR ")})
     AND deleted_at IS NULL`,
    expandParams
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

function hashKey(email, phone) {
  const str = (email || "") + ":" + (phone || "");
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return hash;
}

async function identify(body) {
  const email = normalizeEmail(body.email);
  const phone = normalizePhone(body.phoneNumber);

  if (!email && !phone) {
    return { error: "At least one of email or phoneNumber is required" };
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Advisory lock to prevent race conditions on concurrent requests
    await client.query("SELECT pg_advisory_xact_lock($1)", [
      hashKey(email, phone),
    ]);

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
