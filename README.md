# Identity Merger — Bitespeed Identity Reconciliation

## Problem Understanding

When customers interact with a service using different email addresses or phone numbers, they can end up with multiple contact entries. This service **links all contact records belonging to the same person** into a unified identity, choosing the oldest record as the **primary** contact and marking others as **secondary**.

Given an incoming `email` and/or `phoneNumber`, the `/identify` endpoint returns a consolidated contact with all associated emails, phone numbers, and linked secondary IDs.

---

## Approach

### Matching Logic
1. Search for existing contacts where `email` OR `phone_number` matches the incoming request.
2. Expand the group transitively — collect all emails and phones from initial matches, then fetch all contacts that share **any** of those values.

### Primary Selection
- The **oldest contact** (by `created_at`) in the group is always the primary.
- If multiple primaries exist (e.g., two separate groups being merged), the older one stays primary and others are demoted to secondary.

### Merging Logic
- When a request bridges two previously unrelated groups, `mergePrimaries()` converts the newer primary → secondary with `linked_id` pointing to the oldest.
- A new secondary row is inserted **only if** the request introduces a genuinely new email or phone not already in the group.

### Deduplication
- `hasNewInfo()` checks whether the incoming email/phone already exists in the group before inserting.
- Identical repeated requests produce **no new rows** (idempotent).

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Oldest contact = primary | Deterministic, stable across requests |
| Transactional consistency | All reads + writes wrapped in `BEGIN` / `COMMIT` / `ROLLBACK` |
| Advisory locks (`pg_advisory_xact_lock`) | Prevents race conditions when concurrent requests target the same identity |
| Transitive group expansion | Two-pass query ensures all linked contacts are found, even indirect links |
| Null-safe queries | Dynamically built SQL conditions — `null` email/phone never accidentally matches |
| Input normalization | Emails lowercased + trimmed; phones stripped to digits only |

---

## Edge Cases Handled

| # | Scenario | Expected Behavior |
|---|---|---|
| 1 | Brand new user | Creates a new primary contact |
| 2 | Same request repeated | No new row — idempotent |
| 3 | Partial match (new email, existing phone) | Creates secondary linked to primary |
| 4 | Transitive linking (A↔1, B↔1, B↔2) | All three contacts in one group |
| 5 | Merge two primaries (A↔1 + B↔2, then A↔2) | Older stays primary, newer becomes secondary |
| 6 | Only email provided | Works — phone is null |
| 7 | Only phone provided | Works — email is null |

---

## API Usage

### `POST /identify`

**Request:**
```json
{
  "email": "mcfly@hillvalley.edu",
  "phoneNumber": "123456"
}
```

**Response:**
```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["lorraine@hillvalley.edu", "mcfly@hillvalley.edu"],
    "phoneNumbers": ["123456"],
    "secondaryContactIds": [2]
  }
}
```

- `emails` and `phoneNumbers` always list the **primary's values first**.
- At least one of `email` or `phoneNumber` must be provided.

### `GET /health`

Returns `200 { "status": "ok" }`.

---

## How to Run

### Prerequisites
- Node.js 18+
- Docker (for Postgres)

### Steps

```bash
# 1. Clone the repo
git clone https://github.com/Kartikeya-guthub/Identity-Merger.git
cd Identity-Merger

# 2. Install dependencies
npm install

# 3. Start Postgres
docker run --name bitespeed-pg \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=bitespeed \
  -p 5432:5432 -d postgres:16

# 4. Create the table
docker exec -i bitespeed-pg psql -U postgres -d bitespeed -c "
  CREATE TABLE contacts (
    id SERIAL PRIMARY KEY,
    email TEXT,
    phone_number TEXT,
    linked_id INT,
    link_precedence TEXT CHECK (link_precedence IN ('primary','secondary')),
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP
  );
  CREATE INDEX idx_email ON contacts (email);
  CREATE INDEX idx_phone ON contacts (phone_number);
"

# 5. Create a .env file
echo "PORT=3000
DB_URL=postgresql://postgres:postgres@localhost:5432/bitespeed" > .env

# 6. Start the server
npm run dev
```

### Test it

```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email":"a@example.com","phoneNumber":"1234567890"}'
```

---

## Tech Stack

- **Runtime:** Node.js + Express
- **Database:** PostgreSQL (via `pg` driver)
- **Concurrency:** DB transactions + advisory locks
