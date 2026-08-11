const router = require('express').Router();
const ctrl = require('../controllers/studentsController');
const { requireAuth, requireRole } = require('../middleware/auth');

// Student self-service (must come before /:id to avoid collision)
router.get('/me/profile', requireAuth, requireRole('student'), ctrl.getMyProfile);

// Admin management
router.get('/', requireAuth, requireRole('admin'), ctrl.listStudents);
router.get('/:id', requireAuth, requireRole('admin'), ctrl.getStudent);
router.post('/', requireAuth, requireRole('admin'), ctrl.createStudent);
router.put('/:id', requireAuth, requireRole('admin'), ctrl.updateStudent);
router.delete('/:id', requireAuth, requireRole('admin'), ctrl.deactivateStudent);
router.post('/:id/programs', requireAuth, requireRole('admin'), ctrl.assignProgram);

module.exports = router;
