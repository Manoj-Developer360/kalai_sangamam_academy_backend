const supabase = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const sendResponse = require('../utils/sendResponse');
const ApiError = require('../utils/ApiError');

const computeStatus = (feeAmount, paidAmount) => {
  if (paidAmount <= 0) return 'pending';
  if (paidAmount >= feeAmount) return 'paid';
  return 'partially_paid';
};

const withPayments = async (fees = []) => {
  if (!fees.length) return fees;
  const { data: payments, error } = await supabase
    .from('fee_payments')
    .select('id, fee_id, amount, payment_date, payment_note, created_at')
    .in('fee_id', fees.map((fee) => fee.id))
    .order('payment_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw ApiError.internal(error.message);
  const grouped = (payments || []).reduce((result, payment) => {
    (result[payment.fee_id] ||= []).push(payment);
    return result;
  }, {});
  return fees.map((fee) => ({ ...fee, payments: grouped[fee.id] || [] }));
};

// GET /api/fees (admin) — optional ?student_id=&month=
const listFees = asyncHandler(async (req, res) => {
  const { student_id, month } = req.query;
  let query = supabase.from('fees').select('*, students(full_name, student_code)').order('created_at', { ascending: false });
  if (student_id) query = query.eq('student_id', student_id);
  if (month) query = query.eq('month', month);
  const { data, error } = await query;
  if (error) throw ApiError.internal(error.message);
  sendResponse(res, 200, await withPayments(data || []));
});

// POST /api/fees (admin) — creates one record per student/month and adds an optional payment to it.
// body: { student_id, month, fee_amount, payment_amount?, payment_date?, payment_note? }
const upsertFee = asyncHandler(async (req, res) => {
  const { student_id, month, fee_amount, payment_amount, payment_date, payment_note } = req.body;
  if (!student_id || !month || fee_amount === undefined) {
    throw ApiError.badRequest('student_id, month and fee_amount are required');
  }

  const amountDue = Number(fee_amount);
  const receivedNow = Number(payment_amount || 0);
  if (!Number.isFinite(amountDue) || amountDue < 0) throw ApiError.badRequest('Fee amount must be a valid positive number');
  if (!Number.isFinite(receivedNow) || receivedNow < 0) throw ApiError.badRequest('Payment amount must be a valid positive number');

  const { data: existing, error: existingError } = await supabase
    .from('fees').select('*').eq('student_id', student_id).eq('month', month).maybeSingle();
  if (existingError) throw ApiError.badRequest(existingError.message);

  const totalPaid = Number(existing?.paid_amount || 0) + receivedNow;
  const today = new Date().toISOString().slice(0, 10);
  const { data: fee, error } = await supabase
    .from('fees')
    .upsert({
      student_id,
      month,
      fee_amount: amountDue,
      paid_amount: totalPaid,
      status: computeStatus(amountDue, totalPaid),
      payment_date: receivedNow > 0 ? (payment_date || today) : existing?.payment_date || null,
      payment_note: receivedNow > 0 ? (payment_note || null) : existing?.payment_note || null,
      updated_by: req.user.id,
    }, { onConflict: 'student_id,month' })
    .select()
    .single();
  if (error) throw ApiError.badRequest(error.message);

  if (receivedNow > 0) {
    const { error: paymentError } = await supabase.from('fee_payments').insert({
      fee_id: fee.id,
      amount: receivedNow,
      payment_date: payment_date || today,
      payment_note: payment_note || null,
      received_by: req.user.id,
    });
    if (paymentError) throw ApiError.badRequest(paymentError.message);
  }

  sendResponse(res, 200, (await withPayments([fee]))[0], receivedNow > 0 ? 'Payment added to the monthly fee record.' : 'Monthly fee record saved.');
});

// PATCH /api/fees/:id/status (admin) — retained for existing clients.
const updateFeeStatus = asyncHandler(async (req, res) => {
  const { status, payment_date, payment_note } = req.body;
  if (!status) throw ApiError.badRequest('status is required');
  const { data, error } = await supabase
    .from('fees').update({ status, payment_date, payment_note, updated_by: req.user.id })
    .eq('id', req.params.id).select().single();
  if (error || !data) throw ApiError.notFound('Fee record not found');
  sendResponse(res, 200, data, 'Fee status updated');
});

// GET /api/fees/me (student) — own monthly fees with payment transactions.
const getMyFees = asyncHandler(async (req, res) => {
  const { data: student, error: studentError } = await supabase
    .from('students').select('id').eq('user_id', req.user.id).single();
  if (studentError || !student) throw ApiError.notFound('Student profile not found');
  const { data, error } = await supabase
    .from('fees').select('*').eq('student_id', student.id).order('created_at', { ascending: false });
  if (error) throw ApiError.internal(error.message);
  sendResponse(res, 200, await withPayments(data || []));
});

module.exports = { listFees, upsertFee, updateFeeStatus, getMyFees };
