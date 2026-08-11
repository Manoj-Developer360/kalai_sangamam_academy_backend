const bcrypt = require('bcrypt');
const supabase = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const sendResponse = require('../utils/sendResponse');
const ApiError = require('../utils/ApiError');

const generateStudentCode = async () => {
  const year = new Date().getFullYear();
  const { count } = await supabase
    .from('students')
    .select('id', { count: 'exact', head: true });
  const seq = String((count || 0) + 1).padStart(4, '0');
  return `KS-${year}-${seq}`;
};

// GET /api/students (admin) — optional ?search=&status=
const listStudents = asyncHandler(async (req, res) => {
  const { search, status } = req.query;
  let query = supabase.from('students').select('*, users:user_id(username, email, status)');
  if (status) query = query.eq('status', status);
  if (search) query = query.ilike('full_name', `%${search}%`);
  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) throw ApiError.internal(error.message);
  sendResponse(res, 200, data);
});

// GET /api/students/:id (admin)
const getStudent = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('students')
    .select('*, users:user_id(username, email, status), student_programs(*, programs(name, slug))')
    .eq('id', req.params.id)
    .single();
  if (error || !data) throw ApiError.notFound('Student not found');
  sendResponse(res, 200, data);
});

// POST /api/students (admin) — creates the login (users) + profile (students) rows
const createStudent = asyncHandler(async (req, res) => {
  const {
    username, password, email,
    full_name, date_of_birth, gender, parent_name, parent_contact,
    contact_number, address, blood_group, emergency_contact, joining_date,
  } = req.body;

  if (!username || !password || !full_name) {
    throw ApiError.badRequest('username, password and full_name are required');
  }

  const password_hash = await bcrypt.hash(password, 10);
  const { data: user, error: userError } = await supabase
    .from('users')
    .insert({ role: 'student', username, email, password_hash })
    .select()
    .single();
  if (userError) throw ApiError.conflict(userError.message);

  const student_code = await generateStudentCode();
  const { data: student, error: studentError } = await supabase
    .from('students')
    .insert({
      user_id: user.id,
      student_code,
      full_name,
      date_of_birth,
      gender,
      parent_name,
      parent_contact,
      contact_number,
      address,
      blood_group,
      emergency_contact,
      joining_date,
    })
    .select()
    .single();

  if (studentError) {
    // Roll back the orphaned user row if the profile insert failed
    await supabase.from('users').delete().eq('id', user.id);
    throw ApiError.badRequest(studentError.message);
  }

  sendResponse(res, 201, { ...student, username: user.username }, 'Student created successfully');
});

// PUT /api/students/:id (admin)
const updateStudent = asyncHandler(async (req, res) => {
  const allowedFields = [
    'full_name', 'date_of_birth', 'gender', 'parent_name', 'parent_contact',
    'contact_number', 'address', 'blood_group', 'emergency_contact',
    'joining_date', 'status', 'notes',
  ];
  const payload = {};
  allowedFields.forEach((f) => {
    if (req.body[f] !== undefined) payload[f] = req.body[f];
  });

  const { data, error } = await supabase
    .from('students')
    .update(payload)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error || !data) throw ApiError.notFound('Student not found');
  sendResponse(res, 200, data, 'Student updated successfully');
});

// DELETE /api/students/:id (admin) — deactivates rather than hard-deleting
const deactivateStudent = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('students')
    .update({ status: 'inactive' })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error || !data) throw ApiError.notFound('Student not found');

  await supabase.from('users').update({ status: 'inactive' }).eq('id', data.user_id);
  sendResponse(res, 200, data, 'Student deactivated successfully');
});

// POST /api/students/:id/programs (admin) — assign a program + level
const assignProgram = asyncHandler(async (req, res) => {
  const { program_id, current_level } = req.body;
  if (!program_id) throw ApiError.badRequest('program_id is required');

  const { data, error } = await supabase
    .from('student_programs')
    .upsert(
      { student_id: req.params.id, program_id, current_level, status: 'active' },
      { onConflict: 'student_id,program_id' }
    )
    .select()
    .single();
  if (error) throw ApiError.badRequest(error.message);
  sendResponse(res, 200, data, 'Program assigned');
});

// GET /api/students/me/profile (student) — own profile
const getMyProfile = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('students')
    .select('*, student_programs(*, programs(name, slug))')
    .eq('user_id', req.user.id)
    .single();
  if (error || !data) throw ApiError.notFound('Student profile not found');
  sendResponse(res, 200, data);
});

module.exports = {
  listStudents,
  getStudent,
  createStudent,
  updateStudent,
  deactivateStudent,
  assignProgram,
  getMyProfile,
};
