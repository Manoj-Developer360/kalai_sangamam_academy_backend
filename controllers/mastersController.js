const supabase = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const sendResponse = require('../utils/sendResponse');
const ApiError = require('../utils/ApiError');
const { uploadBuffer, deleteAsset } = require('../services/cloudinaryService');

const listPublic = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('masters')
    .select('*')
    .eq('status', 'active')
    .order('display_order', { ascending: true });
  if (error) throw ApiError.internal(error.message);
  sendResponse(res, 200, data);
});

const listAdmin = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('masters')
    .select('*')
    .order('display_order', { ascending: true });
  if (error) throw ApiError.internal(error.message);
  sendResponse(res, 200, data);
});

// POST /api/masters (admin, multipart/form-data with optional 'photo' file)
const createMaster = asyncHandler(async (req, res) => {
  const { name, role, specialization, experience_years, achievements, bio, display_order } = req.body;
  if (!name || !role) throw ApiError.badRequest('name and role are required');

  let photo_url = null;
  let photo_public_id = null;
  if (req.file) {
    const uploaded = await uploadBuffer(req.file.buffer, { folder: 'kalai-sangamam/masters' });
    photo_url = uploaded.url;
    photo_public_id = uploaded.publicId;
  }

  const { data, error } = await supabase
    .from('masters')
    .insert({
      name, role, specialization,
      experience_years: experience_years ? Number(experience_years) : null,
      achievements, bio,
      display_order: display_order ? Number(display_order) : 0,
      photo_url, photo_public_id,
    })
    .select()
    .single();
  if (error) throw ApiError.badRequest(error.message);
  sendResponse(res, 201, data, 'Master added successfully');
});

// PUT /api/masters/:id (admin, optional new 'photo' file replaces the old one)
const updateMaster = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { data: existing, error: findError } = await supabase.from('masters').select('*').eq('id', id).single();
  if (findError || !existing) throw ApiError.notFound('Master not found');

  const payload = {};
  ['name', 'role', 'specialization', 'achievements', 'bio', 'status'].forEach((f) => {
    if (req.body[f] !== undefined) payload[f] = req.body[f];
  });
  if (req.body.experience_years !== undefined) payload.experience_years = Number(req.body.experience_years);
  if (req.body.display_order !== undefined) payload.display_order = Number(req.body.display_order);

  if (req.file) {
    const uploaded = await uploadBuffer(req.file.buffer, { folder: 'kalai-sangamam/masters' });
    payload.photo_url = uploaded.url;
    payload.photo_public_id = uploaded.publicId;
    if (existing.photo_public_id) await deleteAsset(existing.photo_public_id);
  }

  const { data, error } = await supabase.from('masters').update(payload).eq('id', id).select().single();
  if (error) throw ApiError.badRequest(error.message);
  sendResponse(res, 200, data, 'Master updated successfully');
});

const deleteMaster = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { data: existing } = await supabase.from('masters').select('photo_public_id').eq('id', id).single();
  const { error } = await supabase.from('masters').delete().eq('id', id);
  if (error) throw ApiError.badRequest(error.message);
  if (existing?.photo_public_id) await deleteAsset(existing.photo_public_id);
  sendResponse(res, 200, { id }, 'Master deleted successfully');
});

// PUT /api/masters/reorder (admin) — body: [{ id, display_order }, ...]
const reorderMasters = asyncHandler(async (req, res) => {
  const items = req.body.items;
  if (!Array.isArray(items)) throw ApiError.badRequest('items array is required');

  await Promise.all(
    items.map(({ id, display_order }) =>
      supabase.from('masters').update({ display_order }).eq('id', id)
    )
  );
  sendResponse(res, 200, null, 'Order updated');
});

module.exports = { listPublic, listAdmin, createMaster, updateMaster, deleteMaster, reorderMasters };
