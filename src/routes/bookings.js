const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const crmClient = require('../utils/crmClient');
const webhookManager = require('../utils/webhookManager');
const logger = require('../utils/logger');

/**
 * @api {post} /api/v1/bookings Create a new booking
 * @apiName CreateBooking
 * @apiGroup Bookings
 * @apiVersion 1.0.0
 * 
 * @apiHeader {String} Authorization Bearer token
 * 
 * @apiParam {String} service Service type (plumbing, electrical, etc)
 * @apiParam {Object} customer Customer information
 * @apiParam {String} customer.firstName Customer's first name
 * @apiParam {String} customer.lastName Customer's last name
 * @apiParam {String} customer.email Customer's email
 * @apiParam {String} customer.phone Customer's phone number
 * @apiParam {Object} appointment Appointment details
 * @apiParam {String} appointment.date Appointment date (YYYY-MM-DD)
 * @apiParam {String} appointment.time Appointment time (HH:MM)
 * @apiParam {String} appointment.address Service address
 * 
 * @apiSuccess {String} id Booking ID
 * @apiSuccess {String} status Booking status
 * @apiSuccess {Object} customer Customer details
 * @apiSuccess {Object} appointment Appointment details
 */
router.post('/', 
  authenticate,
  [
    body('service').isString().notEmpty(),
    body('customer.firstName').isString().notEmpty(),
    body('customer.lastName').isString().notEmpty(),
    body('customer.email').isEmail(),
    body('customer.phone').optional().isMobilePhone(),
    body('appointment.date').isISO8601(),
    body('appointment.time').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
    body('appointment.address').isString().notEmpty()
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { service, customer, appointment } = req.body;
      
      // Create lead in CRM
      const lead = await crmClient.createLead({
        firstName: customer.firstName,
        lastName: customer.lastName,
        emailAddress: customer.email,
        description: `Service: ${service}\nAddress: ${appointment.address}`
      });

      // Create appointment
      const meeting = await crmClient.createMeeting({
        name: `${service} - ${customer.firstName} ${customer.lastName}`,
        dateStart: `${appointment.date}T${appointment.time}:00`,
        leadId: lead.id,
        description: `Service: ${service}`,
        status: 'Planned'
      });

      // Create task for assignment
      const task = await crmClient.createTask({
        name: `Assign technician for ${service}`,
        parentType: 'Meeting',
        parentId: meeting.id,
        status: 'Not Started',
        priority: 'High'
      });

      const booking = {
        id: meeting.id,
        leadId: lead.id,
        taskId: task.id,
        service,
        customer,
        appointment,
        status: 'confirmed',
        createdAt: new Date().toISOString()
      };

      // Trigger webhook
      await webhookManager.trigger('booking.created', booking);

      // Log for analytics
      logger.info('Booking created', { 
        bookingId: booking.id, 
        service, 
        apiKey: req.apiKey 
      });

      res.status(201).json(booking);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @api {get} /api/v1/bookings/:id Get booking details
 * @apiName GetBooking
 * @apiGroup Bookings
 * @apiVersion 1.0.0
 */
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const booking = await crmClient.getMeeting(req.params.id);
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    res.json(booking);
  } catch (error) {
    next(error);
  }
});

/**
 * @api {put} /api/v1/bookings/:id Update booking
 * @apiName UpdateBooking
 * @apiGroup Bookings
 * @apiVersion 1.0.0
 */
router.put('/:id', authenticate, async (req, res, next) => {
  try {
    const updated = await crmClient.updateMeeting(req.params.id, req.body);
    
    // Trigger webhook
    await webhookManager.trigger('booking.updated', {
      id: req.params.id,
      changes: req.body
    });
    
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

/**
 * @api {delete} /api/v1/bookings/:id Cancel booking
 * @apiName CancelBooking
 * @apiGroup Bookings
 * @apiVersion 1.0.0
 */
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    await crmClient.updateMeeting(req.params.id, { status: 'Canceled' });
    
    // Trigger webhook
    await webhookManager.trigger('booking.cancelled', { id: req.params.id });
    
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

module.exports = router;