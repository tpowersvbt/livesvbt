'use strict';
const TOPICS = ['personal', 'business', 'wealth', 'other'];

function validateContact(f = {}) {
  const errors = {};
  const s = (v) => (typeof v === 'string' ? v.trim() : '');
  const value = { name: s(f.name), email: s(f.email), topic: s(f.topic) || 'other', message: s(f.message) };
  if (value.name.length < 2 || value.name.length > 100) errors.name = 'Enter your name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) || value.email.length > 200) errors.email = 'Enter a valid email.';
  if (!TOPICS.includes(value.topic)) errors.topic = 'Choose a topic.';
  if (value.message.length < 10 || value.message.length > 2000) errors.message = 'Message must be 10-2000 characters.';
  if (s(f.website)) errors.spam = 'Rejected.';
  return { errors, value };
}
module.exports = { validateContact, TOPICS };
