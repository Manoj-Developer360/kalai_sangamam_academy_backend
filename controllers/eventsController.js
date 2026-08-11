const supabase = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const sendResponse = require('../utils/sendResponse');
const ApiError = require('../utils/ApiError');

// GET /api/events (public) — only active, upcoming-facing events
const listPublic = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('status', 'active')
    .order('event_date', { ascending: true });
  if (error) throw ApiError.internal(error.message);
  sendResponse(res, 200, data);
});

// GET /api/events/admin (admin) — everything including archived
const listAdmin = asyncHandler(async (req, res) => {
  const { data, error } = await supabase.from('events').select('*').order('event_date', { ascending: false });
  if (error) throw ApiError.internal(error.message);
  sendResponse(res, 200, data);
});

const createEvent = asyncHandler(async (req, res) => {
  const payload = { ...req.body };
  if (!payload.title || !payload.event_date) throw ApiError.badRequest('title and event_date are required');
  const { data, error } = await supabase.from('events').insert(payload).select().single();
  if (error) throw ApiError.badRequest(error.message);
  sendResponse(res, 201, data, 'Event created');
});

const updateEvent = asyncHandler(async (req, res) => {
  const { data, error } = await supabase.from('events').update(req.body).eq('id', req.params.id).select().single();
  if (error || !data) throw ApiError.notFound('Event not found');
  sendResponse(res, 200, data, 'Event updated');
});

// PATCH /api/events/:id/close-registration (admin)
const closeRegistration = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('events')
    .update({ registration_status: 'closed' })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error || !data) throw ApiError.notFound('Event not found');
  sendResponse(res, 200, data, 'Registration closed');
});

// PATCH /api/events/:id/archive (admin) — requires explicit confirmation from the client UI
const archiveEvent = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('events')
    .update({ status: 'archived', archived_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error || !data) throw ApiError.notFound('Event not found');
  sendResponse(res, 200, data, 'Event archived');
});

// DELETE /api/events/:id (admin) — permanent delete, confirmed client-side first
const deleteEvent = asyncHandler(async (req, res) => {
  const { error } = await supabase.from('events').delete().eq('id', req.params.id);
  if (error) throw ApiError.badRequest(error.message);
  sendResponse(res, 200, { id: req.params.id }, 'Event permanently deleted');
});

module.exports = { listPublic, listAdmin, createEvent, updateEvent, closeRegistration, archiveEvent, deleteEvent };
