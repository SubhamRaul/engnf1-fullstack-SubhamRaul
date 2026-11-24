const bcrypt = require('bcryptjs');
const db = require('./config/db');
const { classifyTicket } = require('./utils/classifier');

async function seed() {
  // 1. Seed mandatory ADMIN and USER accounts
  const adminHash = await bcrypt.hash('Admin@123', 10);
  const userHash = await bcrypt.hash('User@123', 10);

  await db.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES
       ('Admin Lead', 'admin@triagesync.test', $1, 'ADMIN'),
       ('Agent Demo', 'user@triagesync.test', $2, 'USER')
     ON CONFLICT (LOWER(email)) DO NOTHING`,
    [adminHash, userHash]
  );

  // 2. Seed 6 resources (2 ROOM, 2 LAB, 2 EQUIPMENT; 1 inactive)
  const resources = [
    ['War Room Alpha', 'ROOM', 12, 'Main incident bridge room with video call gear', true],
    ['Quiet Booth B2', 'ROOM', 4, 'Small room for live customer troubleshooting', true],
    ['Network Lab 1', 'LAB', 8, 'Packet capture and firewall testing bench', true],
    ['Mobile QA Lab', 'LAB', 6, 'Physical iOS and Android device rack', true],
    ['Oscilloscope Kit #4', 'EQUIPMENT', 1, 'Portable digital diagnostic oscilloscope', true],
    ['Legacy Server Rack', 'EQUIPMENT', 2, 'Decommissioned rack currently inactive', false],
  ];

  for (const [name, type, capacity, description, isActive] of resources) {
    await db.query(
      `INSERT INTO resources (name, type, capacity, description, is_active)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (LOWER(name)) DO NOTHING`,
      [name, type, capacity, description, isActive]
    );
  }

  // 3. Seed 15 tickets (includes XSS payload ticket & 3 already-reviewed tickets)
  const tickets = [
    ['EXT-001', 'Need refund for duplicate invoice charge', 'I was charged twice on my monthly invoice. Please process a refund.', false, 'OPEN', null],
    ['EXT-002', 'Locked out of account after 2FA reset', 'Urgent: I cannot sign in and my password reset loop locked me out.', false, 'OPEN', null],
    ['EXT-003', 'My package has not arrived', 'Tracking shows delayed shipping for 6 days and delivery never happened.', false, 'OPEN', null],
    ['EXT-004', 'Production down with 500 error on checkout', 'Urgent crash with unhandled exception on the checkout API.', false, 'OPEN', null],
    ['EXT-005', 'Add dark mode toggle to settings', 'Would love a dark theme option for late night support shifts.', false, 'OPEN', null],
    ['EXT-006', 'Payment method update failing', 'Trying to change card for billing payment keeps failing silently.', true, 'IN_PROGRESS', 'BILLING'],
    ['EXT-007', 'Login button broken on Safari', 'Users report password field freezes during sign in on Safari.', true, 'IN_PROGRESS', 'BUG'],
    ['EXT-008', 'Shipping address edit after order', 'Can we change the delivery destination before package dispatch?', true, 'RESOLVED', 'DELIVERY'],
    ['EXT-009', '<script>alert("XSS")</script> Invoice display issue', 'Body has <img src=x onerror=alert(1)> raw HTML tags in invoice view.', false, 'OPEN', null],
    ['EXT-010', 'Export audit logs as CSV', 'Compliance team wants a one-click CSV download button.', false, 'OPEN', null],
    ['EXT-011', 'App crash when uploading large PDF', 'Clicking attach throws a broken pipe exception immediately.', false, 'OPEN', null],
    ['EXT-012', 'Cannot receive 2FA SMS code', 'Login screen asks for 2FA but no SMS arrives on my phone.', false, 'OPEN', null],
    ['EXT-013', 'Wrong tracking link in email', 'My shipping email links to another customer package status.', false, 'OPEN', null],
    ['EXT-014', 'Charge appeared after cancellation', 'Please verify why a payment charge posted this morning.', false, 'OPEN', null],
    ['EXT-015', 'Keyboard shortcuts for ticket queue', 'Agents want J/K navigation keys to triage faster.', false, 'OPEN', null],
  ];

  for (const [extId, subject, body, isReviewed, status, manualCategory] of tickets) {
    const { category, priority } = classifyTicket(subject, body);
    const finalCategory = manualCategory || category;
    const isHumanOverride = manualCategory !== null && manualCategory !== category;

    await db.query(
      `INSERT INTO tickets (external_id, subject, body, auto_category, category, is_human_override, priority, status, is_reviewed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (external_id) DO NOTHING`,
      [extId, subject, body, category, finalCategory, isHumanOverride, priority, status, isReviewed]
    );
  }

  console.log('Seed finished without duplicates.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});