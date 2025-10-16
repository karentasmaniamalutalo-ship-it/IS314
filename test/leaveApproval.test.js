const request = require('supertest');
const app = require('../server'); // your express app
const { sequelize, User, LeaveRequest, LeaveBalance } = require('../models');
const { generateToken } = require('../utils/auth'); // adjust if named differently

let managerToken, employeeToken;

beforeAll(async () => {
  await sequelize.sync({ force: true });

  const manager = await User.create({
    firstName: 'Karen',
    lastName: 'Talo',
    email: 'karen@company.com',
    role: 'manager',
    password: '12345'
  });

  const employee = await User.create({
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@company.com',
    role: 'employee',
    password: '12345'
  });

  managerToken = generateToken(manager);
  employeeToken = generateToken(employee);

  await LeaveBalance.create({
    userId: employee.id,
    leaveTypeId: 1,
    remainingDays: 10
  });

  await LeaveRequest.create({
    userId: employee.id,
    leaveTypeId: 1,
    daysRequested: 5,
    status: 'Pending'
  });
});

afterAll(async () => {
  await sequelize.close();
});

describe('Leave Approval Workflow', () => {
  test('Manager can fetch pending requests', async () => {
    const res = await request(app)
      .get('/api/leave-approval/pending')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.statusCode).toBe(200);
  });

  test('Employee cannot approve leave', async () => {
    const reqs = await LeaveRequest.findOne({ where: { status: 'Pending' } });
    const res = await request(app)
      .put(`/api/leave-approval/${reqs.id}/decision`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ decision: 'Approved', managerComment: 'Not allowed' });
    expect(res.statusCode).toBe(403);
  });

  test('Manager can approve valid request', async () => {
    const reqs = await LeaveRequest.findOne({ where: { status: 'Pending' } });
    const res = await request(app)
      .put(`/api/leave-approval/${reqs.id}/decision`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ decision: 'Approved', managerComment: 'OK' });
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toMatch(/approved successfully/i);
  });
});
