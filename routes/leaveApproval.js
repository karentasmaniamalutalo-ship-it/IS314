const express = require('express');
const router = express.Router();
const { LeaveRequest, LeaveBalance, User } = require('../models');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// Only Manager or HR can access this route
router.use(authenticateToken);
router.use(authorizeRoles(['manager', 'hr']));

/**
 * GET all pending leave requests
 * Example: GET /api/leave-approval/pending
 */
router.get('/pending', async (req, res) => {
  try {
    const pendingRequests = await LeaveRequest.findAll({
      where: { status: 'Pending' },
      include: [
        {
          model: User,
          as: 'applicant',
          attributes: ['id', 'firstName', 'lastName', 'department', 'email']
        }
      ]
    });

    if (pendingRequests.length === 0)
      return res.status(200).json({ message: 'No pending leave requests found' });

    res.status(200).json(pendingRequests);
  } catch (err) {
    console.error('Error fetching pending requests:', err);
    res.status(500).json({ message: 'Error fetching pending requests' });
  }
});

/**
 * PUT approve or reject leave
 * Example: PUT /api/leave-approval/:id/decision
 */
router.put('/:id/decision', async (req, res) => {
  const { id } = req.params;
  const { decision, managerComment } = req.body;

  if (!['Approved', 'Rejected'].includes(decision))
    return res.status(400).json({ message: 'Invalid decision value' });

  try {
    const leaveRequest = await LeaveRequest.findByPk(id);
    if (!leaveRequest)
      return res.status(404).json({ message: 'Leave request not found' });

    if (leaveRequest.status !== 'Pending')
      return res.status(400).json({ message: 'Request already processed' });

    // If approved, check and deduct from LeaveBalance
    if (decision === 'Approved') {
      const balance = await LeaveBalance.findOne({
        where: {
          userId: leaveRequest.userId,
          leaveTypeId: leaveRequest.leaveTypeId
        }
      });

      if (!balance)
        return res.status(404).json({ message: 'Leave balance not found for employee' });

      if (balance.remainingDays < leaveRequest.daysRequested)
        return res.status(400).json({ message: 'Insufficient leave balance' });

      balance.remainingDays -= leaveRequest.daysRequested;
      await balance.save();
    }

    // Update leave request status and metadata
    leaveRequest.status = decision;
    leaveRequest.managerComment = managerComment;
    leaveRequest.reviewedBy = req.user.id;
    leaveRequest.reviewedAt = new Date();
    await leaveRequest.save();

    res.status(200).json({
      message: `Leave ${decision.toLowerCase()} successfully`,
      requestId: leaveRequest.id
    });
  } catch (err) {
    console.error('Error updating leave decision:', err);
    res.status(500).json({ message: 'Error updating leave decision' });
  }
});

module.exports = router;
