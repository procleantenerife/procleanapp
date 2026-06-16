import express from 'express';
import db from './db.js';

const router = express.Router();

// Simple API key guard for all customer routes
router.use((req, res, next) => {
  if (req.headers['x-api-key'] !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  next();
});

// List all customers
router.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM customers ORDER BY name COLLATE NOCASE').all());
});

// Add or update a single customer
router.post('/', (req, res) => {
  const { name, phone, address, service_type, notes } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'name and phone are required' });

  const normPhone = phone.replace(/\D/g, '');
  db.prepare(`
    INSERT INTO customers (name, phone, address, service_type, notes)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(phone) DO UPDATE SET
      name         = excluded.name,
      address      = COALESCE(excluded.address, address),
      service_type = COALESCE(excluded.service_type, service_type),
      notes        = COALESCE(excluded.notes, notes)
  `).run(name, normPhone, address || null, service_type || null, notes || null);

  const customer = db.prepare('SELECT * FROM customers WHERE phone = ?').get(normPhone);
  res.status(201).json(customer);
});

// Update by phone
router.put('/:phone', (req, res) => {
  const { name, address, service_type, notes } = req.body;
  const result = db.prepare(`
    UPDATE customers SET name=?, address=?, service_type=?, notes=? WHERE phone=?
  `).run(name, address || null, service_type || null, notes || null, req.params.phone);
  if (result.changes === 0) return res.status(404).json({ error: 'Customer not found' });
  res.json({ ok: true });
});

// Delete by phone
router.delete('/:phone', (req, res) => {
  db.prepare('DELETE FROM customers WHERE phone = ?').run(req.params.phone);
  res.json({ ok: true });
});

/**
 * Bulk import from the PWA's localStorage export.
 *
 * Usage (run in browser console on the PWA):
 *   copy(JSON.stringify(JSON.parse(localStorage.getItem('pc_customers'))))
 *
 * Then POST the copied JSON array to this endpoint.
 */
router.post('/import', (req, res) => {
  if (!Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Body must be a JSON array of customer objects' });
  }

  const insert = db.prepare(`
    INSERT INTO customers (id, name, phone, address, service_type, notes)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(phone) DO NOTHING
  `);

  const importAll = db.transaction(rows => {
    let imported = 0;
    let skipped = 0;
    for (const c of rows) {
      if (!c.name) { skipped++; continue; }
      const normPhone = c.phone ? c.phone.replace(/\D/g, '') : null;
      insert.run(
        c.id || null,
        c.name,
        normPhone || null,
        c.address || null,
        c.type || null,
        c.notes || null
      );
      imported++;
    }
    return { imported, skipped };
  });

  const result = importAll(req.body);
  res.json(result);
});

// View message history for a customer
router.get('/:phone/messages', (req, res) => {
  const messages = db.prepare(`
    SELECT direction, body, template_name, sent_at
    FROM messages WHERE customer_phone = ?
    ORDER BY sent_at DESC LIMIT 50
  `).all(req.params.phone);
  res.json(messages);
});

export default router;
