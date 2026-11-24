function classifyTicket(subject = '', body = '') {
  const text = `${subject} ${body}`.toLowerCase();

  let category = 'FEATURE_REQUEST';
  if (['refund', 'invoice', 'charge', 'payment'].some((w) => text.includes(w))) {
    category = 'BILLING';
  } else if (['password', '2fa', 'sign in', 'locked out', 'login'].some((w) => text.includes(w))) {
    category = 'LOGIN';
  } else if (['package', 'arrived', 'shipping', 'tracking', 'delivery'].some((w) => text.includes(w))) {
    category = 'DELIVERY';
  } else if (['crash', 'error', '500', 'exception', 'broken'].some((w) => text.includes(w))) {
    category = 'BUG';
  }

  let priority = 'MEDIUM';
  if (['urgent', 'production down', 'locked out'].some((w) => text.includes(w))) {
    priority = 'URGENT';
  } else if (['error', 'refund', 'not arrived'].some((w) => text.includes(w))) {
    priority = 'HIGH';
  }

  return { category, priority };
}

module.exports = { classifyTicket };