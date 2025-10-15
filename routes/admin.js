const express = require('express');
const { body, validationResult } = require('express-validator');
const { User, LeaveBalance, LeaveType, DefaultBalance } = require('../models');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { 
  updateEmployeeLeaveBalance, 
  getEmployeeLeaveBalance, 
  bulkUpdateLeaveBalances,
  processFinancialYearRollover,
  getCurrentFinancialYear,
  initializeEmployeeLeaveBalances
} = require('../utils/leaveBalance');

const router = express.Router();

// All routes require admin authentication
router.use(authenticateToken);
router.use(authorizeRoles(['admin']));

// Get all employees with their leave balances
router.get('/employees/leave-balances', async (req, res) => {
  try {
    const currentYear = getCurrentFinancialYear();
    
    const employees = await User.findAll({
      where: { isActive: true },
      attributes: ['id', 'employeeId', 'firstName', 'lastName', 'email', 'department', 'position'],
      include: [
        {
          model: LeaveBalance,
          as: 'leaveBalances',
          where: { year: currentYear, isActive: true },
          required: false,
          include: [
            {
              model: LeaveType,
              as: 'leaveType',
              attributes: ['id', 'name', 'description', 'color']
            }
          ]
        }
      ],
      order: [['firstName', 'ASC']]
    });

    res.json(employees);
  } catch (error) {
    console.error('Error fetching employees with leave balances:', error);
    res.status(500).json({ message: 'Error fetching employee leave balances' });
  }
});

// Get specific employee's leave balance
router.get('/employees/:userId/leave-balance', async (req, res) => {
  try {
    const { userId } = req.params;
    const { year } = req.query;
    
    const employee = await User.findByPk(userId, {
      attributes: ['id', 'employeeId', 'firstName', 'lastName', 'email', 'department', 'position']
    });
    
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    
    const balances = await getEmployeeLeaveBalance(userId, year);
    
    res.json({
      employee,
      balances,
      currentYear: getCurrentFinancialYear()
    });
  } catch (error) {
    console.error('Error fetching employee leave balance:', error);
    res.status(500).json({ message: 'Error fetching employee leave balance' });
  }
});

// Update employee leave balance
router.put('/employees/:userId/leave-balance', [
  body('leaveTypeId').isInt().withMessage('Valid leave type is required'),
  body('totalDays').isFloat({ min: 0 }).withMessage('Total days must be a positive number'),
  body('usedDays').isFloat({ min: 0 }).withMessage('Used days must be a positive number'),
  body('carriedOverDays').optional().isFloat({ min: 0 }).withMessage('Carried over days must be a positive number'),
  body('maxCarryOver').optional().isFloat({ min: 0 }).withMessage('Max carry over must be a positive number'),
  body('notes').optional().isLength({ max: 500 }).withMessage('Notes must be less than 500 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Please check your input data',
        details: errors.array()
      });
    }

    const { userId } = req.params;
    const { leaveTypeId, totalDays, usedDays, carriedOverDays, maxCarryOver, notes } = req.body;
    
    // Check if employee exists
    const employee = await User.findByPk(userId);
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    
    // Check if leave type exists
    const leaveType = await LeaveType.findByPk(leaveTypeId);
    if (!leaveType) {
      return res.status(404).json({ message: 'Leave type not found' });
    }
    
    const balance = await updateEmployeeLeaveBalance(
      req.user.id,
      userId,
      leaveTypeId,
      {
        totalDays,
        usedDays,
        carriedOverDays,
        maxCarryOver,
        notes
      }
    );
    
    res.json({
      message: 'Leave balance updated successfully',
      balance
    });
  } catch (error) {
    console.error('Error updating leave balance:', error);
    res.status(500).json({ message: 'Error updating leave balance' });
  }
});

// Bulk update leave balances
router.post('/employees/bulk-update-leave-balances', [
  body('updates').isArray().withMessage('Updates must be an array'),
  body('updates.*.userId').isInt().withMessage('Valid user ID is required'),
  body('updates.*.leaveTypeId').isInt().withMessage('Valid leave type ID is required'),
  body('updates.*.totalDays').isFloat({ min: 0 }).withMessage('Total days must be a positive number'),
  body('updates.*.usedDays').isFloat({ min: 0 }).withMessage('Used days must be a positive number')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Please check your input data',
        details: errors.array()
      });
    }

    const { updates } = req.body;
    
    const results = await bulkUpdateLeaveBalances(req.user.id, updates);
    
    const successCount = results.filter(r => r.success).length;
    const errorCount = results.filter(r => !r.success).length;
    
    res.json({
      message: `Bulk update completed. ${successCount} successful, ${errorCount} failed.`,
      results
    });
  } catch (error) {
    console.error('Error in bulk update:', error);
    res.status(500).json({ message: 'Error in bulk update' });
  }
});

// Initialize leave balances for new employee
router.post('/employees/:userId/initialize-balances', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Check if employee exists
    const employee = await User.findByPk(userId);
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    
    const balances = await initializeEmployeeLeaveBalances(userId);
    
    res.json({
      message: 'Leave balances initialized successfully',
      balances
    });
  } catch (error) {
    console.error('Error initializing leave balances:', error);
    res.status(500).json({ message: 'Error initializing leave balances' });
  }
});

// Process financial year rollover
router.post('/financial-year-rollover', [
  body('newYear').isInt({ min: 2020, max: 2030 }).withMessage('Valid year is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Please check your input data',
        details: errors.array()
      });
    }

    const { newYear } = req.body;
    
    // Get current default balance settings
    let defaultBalance = null;
    try {
      const defaultBalanceRecord = await DefaultBalance.findOne({
        where: { isActive: true },
        order: [['createdAt', 'DESC']]
      });
      
      if (defaultBalanceRecord) {
        defaultBalance = {
          annualLeave: defaultBalanceRecord.annualLeave,
          sickLeave: defaultBalanceRecord.sickLeave,
          personalLeave: defaultBalanceRecord.personalLeave,
          maxCarryOver: defaultBalanceRecord.maxCarryOver
        };
      }
    } catch (error) {
      console.error('Error fetching default balance:', error);
      // Continue without default balance
    }
    
    const result = await processFinancialYearRollover(newYear, defaultBalance);
    
    res.json({
      message: 'Financial year rollover completed successfully',
      ...result
    });
  } catch (error) {
    console.error('Error in financial year rollover:', error);
    res.status(500).json({ message: 'Error in financial year rollover' });
  }
});

// Get financial year information
router.get('/financial-year-info', async (req, res) => {
  try {
    const currentYear = getCurrentFinancialYear();
    const { startDate, endDate } = getFinancialYearDates(currentYear);
    
    res.json({
      currentYear,
      startDate,
      endDate,
      isCurrentYear: true
    });
  } catch (error) {
    console.error('Error getting financial year info:', error);
    res.status(500).json({ message: 'Error getting financial year information' });
  }
});

// Get leave types for admin management
router.get('/leave-types', async (req, res) => {
  try {
    const leaveTypes = await LeaveType.findAll({
      where: { isActive: true },
      order: [['name', 'ASC']]
    });
    
    res.json(leaveTypes);
  } catch (error) {
    console.error('Error fetching leave types:', error);
    res.status(500).json({ message: 'Error fetching leave types' });
  }
});

// Save default leave balance settings
router.post('/default-balance', [
  body('annualLeave').isFloat({ min: 0 }).withMessage('Annual leave must be a positive number'),
  body('sickLeave').isFloat({ min: 0 }).withMessage('Sick leave must be a positive number'),
  body('personalLeave').isFloat({ min: 0 }).withMessage('Personal leave must be a positive number'),
  body('maxCarryOver').isFloat({ min: 0 }).withMessage('Max carry over must be a positive number')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Please check your input data',
        details: errors.array()
      });
    }

    const { annualLeave, sickLeave, personalLeave, maxCarryOver } = req.body;
    
    // Deactivate all existing default balances
    await DefaultBalance.update(
      { isActive: false },
      { where: { isActive: true } }
    );
    
    // Create new default balance
    const defaultBalance = await DefaultBalance.create({
      annualLeave: parseFloat(annualLeave),
      sickLeave: parseFloat(sickLeave),
      personalLeave: parseFloat(personalLeave),
      maxCarryOver: parseFloat(maxCarryOver),
      updatedBy: req.user.id,
      isActive: true,
      notes: `Updated by ${req.user.firstName} ${req.user.lastName} on ${new Date().toLocaleDateString()}`
    });
    
    res.json({
      message: 'Default balance settings saved successfully',
      defaultBalance
    });
  } catch (error) {
    console.error('Error saving default balance:', error);
    res.status(500).json({ message: 'Error saving default balance settings' });
  }
});

// Get default leave balance settings
router.get('/default-balance', async (req, res) => {
  try {
    const defaultBalance = await DefaultBalance.findOne({
      where: { isActive: true },
      order: [['createdAt', 'DESC']]
    });
    
    if (defaultBalance) {
      res.json({
        annualLeave: defaultBalance.annualLeave,
        sickLeave: defaultBalance.sickLeave,
        personalLeave: defaultBalance.personalLeave,
        maxCarryOver: defaultBalance.maxCarryOver
      });
    } else {
      // Return default values if no settings found
      res.json({
        annualLeave: 20,
        sickLeave: 10,
        personalLeave: 5,
        maxCarryOver: 5
      });
    }
  } catch (error) {
    console.error('Error fetching default balance:', error);
    res.status(500).json({ message: 'Error fetching default balance settings' });
  }
});

// ============================================================
// LEAVE BALANCE MANAGEMENT (Karen’s Functionality)
// ============================================================

const { LeaveBalance, LeaveType, User } = require('../models');
const {
  getEmployeeLeaveBalance,
  updateEmployeeLeaveBalance,
  processFinancialYearRollover
} = require('../utils/leaveBalance');

// Get all employees with their leave balances
router.get('/employees/leave-balances', async (req, res) => {
  try {
    const employees = await User.findAll({
      where: { isActive: true },
      attributes: ['id', 'firstName', 'lastName', 'email', 'department', 'position'],
      include: [
        {
          model: LeaveBalance,
          as: 'leaveBalances',
          include: [{ model: LeaveType, as: 'leaveType', attributes: ['name'] }],
        },
      ],
    });

    res.status(200).json(employees);
  } catch (err) {
    console.error('Error fetching leave balances:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Update a specific employee’s leave balance
router.put('/employees/:id/leave-balances', async (req, res) => {
  try {
    const employeeId = req.params.id;
    const updates = req.body; // { leaveTypeId, newBalance }

    await updateEmployeeLeaveBalance(employeeId, updates.leaveTypeId, updates.newBalance);

    res.status(200).json({ message: 'Leave balance updated successfully' });
  } catch (err) {
    console.error('Error updating leave balance:', err);
    res.status(500).json({ error: 'Could not update leave balance' });
  }
});

// Rollover balances for new financial year
router.post('/employees/rollover', async (req, res) => {
  try {
    const result = await processFinancialYearRollover();
    res.status(200).json({ message: 'Rollover completed successfully', result });
  } catch (err) {
    console.error('Error in rollover:', err);
    res.status(500).json({ error: 'Failed to process rollover' });
  }
});
module.exports = router; 
