const pool = require("./db/connection");

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contacts (
      id SERIAL PRIMARY KEY,
      email TEXT,
      phone_number TEXT,
      linked_id INT,
      link_precedence TEXT CHECK (link_precedence IN ('primary','secondary')),
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now(),
      deleted_at TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_email ON contacts (email);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_phone ON contacts (phone_number);
  `);

  console.log("Migration complete");
}

module.exports = migrate;
