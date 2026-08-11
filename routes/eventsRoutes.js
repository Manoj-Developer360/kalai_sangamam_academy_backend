const router = require('express').Router();
const ctrl = require('../controllers/eventsController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/', ctrl.listPublic);
router.get('/admin', requireAuth, requireRole('admin'), ctrl.listAdmin);
router.post('/', requireAuth, requireRole('admin'), ctrl.createEvent);
router.put('/:id', requireAuth, requireRole('admin'), ctrl.updateEvent);
router.patch('/:id/close-registration', requireAuth, requireRole('admin'), ctrl.closeRegistration);
router.patch('/:id/archive', requireAuth, requireRole('admin'), ctrl.archiveEvent);
router.delete('/:id', requireAuth, requireRole('admin'), ctrl.deleteEvent);

module.exports = router;
