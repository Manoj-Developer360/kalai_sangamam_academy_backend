const supabase = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const sendResponse = require('../utils/sendResponse');
const ApiError = require('../utils/ApiError');

const computeStatus = (feeAmount, paidAmount) => {
  if (paidAmount <= 0) return 'pending';
  if (paidAmount >= feeAmount) return 'paid';
  return 'partially_paid';
};

// GET /api/fees (admin) — optional ?student_id=&month=
const listFees = asyncHandler(async (req, res) => {
  const { student_id, month } = req.query;
  let query = supabase.from('fees').select('*, students(full_name, student_code)').order('created_at', { ascending: false });
  if (student_id) query = query.eq('student_id', student_id);
  if (month) query = query.eq('month', month);
  const { data, error } = await query;
  if (error) throw ApiError.internal(error.message);
  sendResponse(res, 200, data);
});

// POST /api/fees (admin) — create or update a student's fee record for a month
// body: { student_id, month, fee_amount, paid_amount, status?, payment_date?, payment_note? }
const upsertFee = asyncHandler(async (req, res) => {
  const { student_id, month, fee_amount, paid_amount, payment_date, payment_note, status } = req.body;
  if (!student_id || !month || fee_amount === undefined) {
    throw ApiError.badRequest('student_id, month and fee_amount are required');
  }

  const resolvedStatus = status || computeStatus(Number(fee_amount), Number(paid_amount || 0));

  const { data, error } = await supabase
    .from('fees')
    .upsert(
      {
        student_id,
        month,
        fee_amount: Number(fee_amount),
        paid_amount: Number(paid_amount || 0),
        status: resolvedStatus,
        payment_date: payment_date || null,
        payment_note: payment_note || null,
        updated_by: req.user.id,
      },
      { onConflict: 'student_id,month' }
    )
    .select()
    .single();
  if (error) throw ApiError.badRequest(error.message);
  sendResponse(res, 200, data, 'Fee record saved. Student dashboard will reflect this immediately.');
});

// PATCH /api/fees/:id/status (admin) — quick status-only update
const updateFeeStatus = asyncHandler(async (req, res) => {
  const { status, payment_date, payment_note } = req.body;
  if (!status) throw ApiError.badRequest('status is required');

  const { data, error } = await supabase
    .from('fees')
    .update({ status, payment_date, payment_note, updated_by: req.user.id })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error || !data) throw ApiError.notFound('Fee record not found');
  sendResponse(res, 200, data, 'Fee status updated');
});

// GET /api/fees/me (student) — own fee history
const getMyFees = asyncHandler(async (req, res) => {
  const { data: student, error: studentError } = await supabase
    .from('students')
    .select('id')
    .eq('user_id', req.user.id)
    .single();
  if (studentError || !student) throw ApiError.notFound('Student profile not found');

  const { data, error } = await supabase
    .from('fees')
    .select('*')
    .eq('student_id', student.id)
    .order('created_at', { ascending: false });
  if (error) throw ApiError.internal(error.message);
  sendResponse(res, 200, data);
});

module.exports = { listFees, upsertFee, updateFeeStatus, getMyFees };
