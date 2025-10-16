// ============================================================
// utils/leaveBalance.js
// Author: Karen (karen-branch)
// Helper functions for Leave Balance Management
// ============================================================

const { LeaveBalance, User, LeaveType } = require('../models');

/**
 * Get all leave balances for one employee
 * @param {number} employeeId - ID of the employee
 * @returns {Promise<Array>} List of leave balances
 */
async function getEmployeeLeaveBalance(employeeId) {
  return await LeaveBalance.findAll({
    where: { userId: employeeId },
    include: [{ model: LeaveType, as: 'leaveType', attributes: ['name'] }],
  });
}

/**
 *  Update an employee's leave balance
 * @param {number} employeeId - The employee's ID
 * @param {number} leaveTypeId - Type of leave to update
 * @param {number} newBalance - New remaining balance
 */
async function updateEmployeeLeaveBalance(employeeId, leaveTypeId, newBalance) {
  const balance = await LeaveBalance.findOne({
    where: { userId: employeeId, leaveTypeId },
  });

  if (!balance) throw new Error('Leave balance record not found');

  balance.remainingDays = newBalance;
  await balance.save();
  return balance;
}

/**
 *  Process rollover for new financial year
 * Resets balances and stores previous year data
 */
async function processFinancialYearRollover() {
  const allBalances = await LeaveBalance.findAll();
  let updated = 0;

  for (const record of allBalances) {
    record.previousYearDays = record.remainingDays;
    record.remainingDays = record.defaultDays;
    record.year = new Date().getFullYear();
    await record.save();
    updated++;
  }

  return { updated };
}

/**
 *  Bulk initialize leave balances for all employees
 * (Optional - use during setup or when a new employee joins)
 */
async function initializeEmployeeLeaveBalances() {
  const employees = await User.findAll();
  const leaveTypes = await LeaveType.findAll();
  const year = new Date().getFullYear();

  let created = 0;

  for (const emp of employees) {
    for (const type of leaveTypes) {
      await LeaveBalance.findOrCreate({
        where: { userId: emp.id, leaveTypeId: type.id, year },
        defaults: {
          remainingDays: type.defaultDays,
          previousYearDays: 0,
          defaultDays: type.defaultDays,
        },
      });
      created++;
    }
  }

  return { created };
}

module.exports = {
  getEmployeeLeaveBalance,
  updateEmployeeLeaveBalance,
  processFinancialYearRollover,
  initializeEmployeeLeaveBalances,
};

 */
function getFinancialYearDates(year) {
  return {
    startDate: new Date(year, 3, 1), // April 1st
    endDate: new Date(year + 1, 2, 31) // March 31st
  };
}

/**
 * Initialize leave balances for a new employee
 */
async function initializeEmployeeLeaveBalances(userId, currentYear = null) {
  try {
    const year = currentYear || getCurrentFinancialYear();
    const leaveTypes = await LeaveType.findAll({ where: { isActive: true } });
    
    const balances = [];
    
    for (const leaveType of leaveTypes) {
      const balance = await LeaveBalance.create({
        userId,
        leaveTypeId: leaveType.id,
        year,
        totalDays: leaveType.defaultDays,
        usedDays: 0,
        remainingDays: leaveType.defaultDays,
        carriedOverDays: 0,
        maxCarryOver: leaveType.name.toLowerCase().includes('annual') ? 5 : 0,
        isActive: true
      });
      
      balances.push(balance);
    }
    
    return balances;
  } catch (error) {
    console.error('Error initializing leave balances:', error);
    throw error;
  }
}

/**
 * Process financial year rollover for all employees
 */
async function processFinancialYearRollover(newYear, defaultBalance = null) {
  try {
    const previousYear = newYear - 1;
    
    // Get all active employees
    const employees = await User.findAll({
      where: { isActive: true },
      attributes: ['id', 'employeeId', 'firstName', 'lastName']
    });
    
    const leaveTypes = await LeaveType.findAll({ where: { isActive: true } });
    
    // Use default balance settings if provided, otherwise use leave type defaults
    const getDefaultDays = (leaveTypeName) => {
      if (!defaultBalance) return null;
      
      const name = leaveTypeName.toLowerCase();
      if (name.includes('annual')) return defaultBalance.annualLeave;
      if (name.includes('sick')) return defaultBalance.sickLeave;
      if (name.includes('personal')) return defaultBalance.personalLeave;
      return null; // Use leave type default
    };
    
    let processedCount = 0;
    let errors = [];
    
    for (const employee of employees) {
      try {
        for (const leaveType of leaveTypes) {
          // Get previous year's balance
          const previousBalance = await LeaveBalance.findOne({
            where: {
              userId: employee.id,
              leaveTypeId: leaveType.id,
              year: previousYear,
              isActive: true
            }
          });
          
          // Get or create current year's balance
          let currentBalance = await LeaveBalance.findOne({
            where: {
              userId: employee.id,
              leaveTypeId: leaveType.id,
              year: newYear,
              isActive: true
            }
          });
          
          if (!currentBalance) {
            // Calculate carried over days
            const carriedOverDays = previousBalance ? 
              Math.min(previousBalance.remainingDays, previousBalance.maxCarryOver) : 0;
            
            // Use default balance or leave type default
            const totalDays = getDefaultDays(leaveType.name) || leaveType.defaultDays;
            const maxCarryOver = defaultBalance ? defaultBalance.maxCarryOver : 
              (leaveType.name.toLowerCase().includes('annual') ? 5 : 0);
            
            currentBalance = await LeaveBalance.create({
              userId: employee.id,
              leaveTypeId: leaveType.id,
              year: newYear,
              totalDays,
              usedDays: 0,
              remainingDays: totalDays + carriedOverDays,
              carriedOverDays,
              maxCarryOver,
              isActive: true,
              notes: `Auto-generated for FY ${newYear}-${newYear + 1}`
            });
          }
        }
        
        processedCount++;
      } catch (error) {
        console.error(`Error processing rollover for employee ${employee.employeeId}:`, error);
        errors.push({
          employeeId: employee.employeeId,
          error: error.message
        });
      }
    }
    
    return {
      success: true,
      processedCount,
      errors,
      message: `Financial year rollover completed. Processed ${processedCount} employees.`
    };
  } catch (error) {
    console.error('Error in financial year rollover:', error);
    throw error;
  }
}

/**
 * Update employee leave balance (Admin function)
 */
async function updateEmployeeLeaveBalance(adminId, userId, leaveTypeId, updates) {
  try {
    const currentYear = getCurrentFinancialYear();
    
    let balance = await LeaveBalance.findOne({
      where: {
        userId,
        leaveTypeId,
        year: currentYear,
        isActive: true
      }
    });
    
    if (!balance) {
      // Create new balance if it doesn't exist
      const leaveType = await LeaveType.findByPk(leaveTypeId);
      balance = await LeaveBalance.create({
        userId,
        leaveTypeId,
        year: currentYear,
        totalDays: updates.totalDays || leaveType.defaultDays,
        usedDays: updates.usedDays || 0,
        remainingDays: (updates.totalDays || leaveType.defaultDays) - (updates.usedDays || 0),
        carriedOverDays: updates.carriedOverDays || 0,
        maxCarryOver: updates.maxCarryOver || 5,
        isActive: true,
        lastUpdatedBy: adminId,
        notes: updates.notes || 'Admin adjustment'
      });
    } else {
      // Update existing balance
      const updateData = {
        ...updates,
        lastUpdatedBy: adminId,
        updatedAt: new Date()
      };
      
      // Recalculate remaining days
      if (updates.totalDays !== undefined || updates.usedDays !== undefined || updates.carriedOverDays !== undefined) {
        const totalDays = updates.totalDays !== undefined ? updates.totalDays : balance.totalDays;
        const usedDays = updates.usedDays !== undefined ? updates.usedDays : balance.usedDays;
        const carriedOverDays = updates.carriedOverDays !== undefined ? updates.carriedOverDays : balance.carriedOverDays;
        
        updateData.remainingDays = totalDays - usedDays + carriedOverDays;
      }
      
      await balance.update(updateData);
    }
    
    return balance;
  } catch (error) {
    console.error('Error updating employee leave balance:', error);
    throw error;
  }
}

/**
 * Get employee leave balance summary
 */
async function getEmployeeLeaveBalance(userId, year = null) {
  try {
    const currentYear = year || getCurrentFinancialYear();
    
    const balances = await LeaveBalance.findAll({
      where: {
        userId,
        year: currentYear,
        isActive: true
      },
      include: [
        {
          model: LeaveType,
          as: 'leaveType',
          attributes: ['id', 'name', 'description', 'color']
        }
      ],
      order: [['leaveTypeId', 'ASC']]
    });
    
    return balances;
  } catch (error) {
    console.error('Error getting employee leave balance:', error);
    throw error;
  }
}

/**
 * Bulk update leave balances for multiple employees
 */
async function bulkUpdateLeaveBalances(adminId, updates) {
  try {
    const results = [];
    
    for (const update of updates) {
      try {
        const balance = await updateEmployeeLeaveBalance(
          adminId,
          update.userId,
          update.leaveTypeId,
          update
        );
        
        results.push({
          success: true,
          userId: update.userId,
          leaveTypeId: update.leaveTypeId,
          balance
        });
      } catch (error) {
        results.push({
          success: false,
          userId: update.userId,
          leaveTypeId: update.leaveTypeId,
          error: error.message
        });
      }
    }
    
    return results;
  } catch (error) {
    console.error('Error in bulk update leave balances:', error);
    throw error;
  }
}

module.exports = {
  getCurrentFinancialYear,
  getFinancialYearDates,
  initializeEmployeeLeaveBalances,
  processFinancialYearRollover,
  updateEmployeeLeaveBalance,
  getEmployeeLeaveBalance,
  bulkUpdateLeaveBalances
}; 
