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
const studentProfileFields = [
  'full_name', 'date_of_birth', 'gender', 'parent_name', 'parent_contact',
  'contact_number', 'address', 'blood_group', 'emergency_contact',
  'joining_date',
];

const buildStudentProfilePayload = (body) => {
  const payload = {};
  studentProfileFields.forEach((field) => {
    if (body[field] !== undefined) payload[field] = body[field];
  });
  return payload;
};

const createStudentFromPayload = async (body) => {
  const {
    username, password, email, password_hash,
    full_name, date_of_birth, gender, parent_name, parent_contact,
    contact_number, address, blood_group, emergency_contact, joining_date,
  } = body;

  if (!username || (!password && !password_hash) || !full_name) {
    throw ApiError.badRequest('username, password and full_name are required');
  }

  const finalPasswordHash = password_hash || await bcrypt.hash(password, 10);
  const { data: user, error: userError } = await supabase
    .from('users')
    .insert({ role: 'student', username, email, password_hash: finalPasswordHash })
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
    await supabase.from('users').delete().eq('id', user.id);
    throw ApiError.badRequest(studentError.message);
  }

  return { student, user };
};

// GET /api/students (admin) - optional ?search=&status=
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

const registerStudentRequest = asyncHandler(async (req, res) => {
  const { username, password, email, full_name } = req.body;
  if (!username || !password || !full_name) {
    throw ApiError.badRequest('username, password and full_name are required');
  }
  if (password.length < 6) {
    throw ApiError.badRequest('Password must be at least 6 characters');
  }

  const { data: usernameExists } = await supabase
    .from('users')
    .select('id')
    .eq('username', username)
    .maybeSingle();
  if (usernameExists) throw ApiError.conflict('Username is already in use');

  if (email) {
    const { data: emailExists } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (emailExists) throw ApiError.conflict('Email is already in use');
  }

  const { data: existingRequest } = await supabase
    .from('student_registration_requests')
    .select('id')
    .eq('username', username)
    .eq('status', 'pending')
    .maybeSingle();
  if (existingRequest) throw ApiError.conflict('A pending request already exists for this username');

  if (email) {
    const { data: existingEmailRequest } = await supabase
      .from('student_registration_requests')
      .select('id')
      .eq('email', email)
      .eq('status', 'pending')
      .maybeSingle();
    if (existingEmailRequest) throw ApiError.conflict('A pending request already exists for this email');
  }

  const password_hash = await bcrypt.hash(password, 10);
  const { data, error } = await supabase
    .from('student_registration_requests')
    .insert({
      username,
      email,
      password_hash,
      ...buildStudentProfilePayload(req.body),
    })
    .select('id, username, email, full_name, date_of_birth, gender, parent_name, parent_contact, contact_number, address, blood_group, emergency_contact, joining_date, status, created_at')
    .single();
  if (error) throw ApiError.badRequest(error.message);

  sendResponse(res, 201, data, 'Registration request submitted successfully');
});

const listRegistrationRequests = asyncHandler(async (req, res) => {
  const { status = 'pending' } = req.query;
  let query = supabase
    .from('student_registration_requests')
    .select('id, username, email, full_name, date_of_birth, gender, parent_name, parent_contact, contact_number, address, blood_group, emergency_contact, joining_date, status, reviewed_by, reviewed_at, created_at, updated_at');
  if (status) query = query.eq('status', status);
  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) throw ApiError.internal(error.message);
  sendResponse(res, 200, data);
});

const approveRegistrationRequest = asyncHandler(async (req, res) => {
  const { data: request, error } = await supabase
    .from('student_registration_requests')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error || !request) throw ApiError.notFound('Registration request not found');
  if (request.status !== 'pending') throw ApiError.badRequest('Only pending requests can be approved');

  const { student, user } = await createStudentFromPayload(request);

  const { error: updateError } = await supabase
    .from('student_registration_requests')
    .update({ status: 'approved', reviewed_by: req.user.id, reviewed_at: new Date().toISOString() })
    .eq('id', request.id);
  if (updateError) {
    await supabase.from('students').delete().eq('id', student.id);
    await supabase.from('users').delete().eq('id', user.id);
    throw ApiError.badRequest(updateError.message);
  }

  sendResponse(res, 200, student, 'Registration request approved');
});

const rejectRegistrationRequest = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('student_registration_requests')
    .update({ status: 'rejected', reviewed_by: req.user.id, reviewed_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('status', 'pending')
    .select('id, username, email, full_name, status, reviewed_by, reviewed_at, created_at, updated_at')
    .single();
  if (error || !data) throw ApiError.notFound('Pending registration request not found');
  sendResponse(res, 200, data, 'Registration request rejected');
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
  const { student, user } = await createStudentFromPayload(req.body);
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
  registerStudentRequest,
  listRegistrationRequests,
  approveRegistrationRequest,
  rejectRegistrationRequest,
  getStudent,
  createStudent,
  updateStudent,
  deactivateStudent,
  assignProgram,
  getMyProfile,
};
