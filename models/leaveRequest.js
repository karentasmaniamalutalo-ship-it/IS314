module.exports = (sequelize, DataTypes) => {
  const LeaveRequest = sequelize.define('LeaveRequest', {
    userId: DataTypes.INTEGER,
    leaveTypeId: DataTypes.INTEGER,
    startDate: DataTypes.DATE,
    endDate: DataTypes.DATE,
    daysRequested: DataTypes.INTEGER,
    status: {
      type: DataTypes.STRING,
      defaultValue: 'Pending'
    },
    managerComment: DataTypes.STRING,
    reviewedBy: DataTypes.INTEGER,
    reviewedAt: DataTypes.DATE
  });

  LeaveRequest.associate = (models) => {
    LeaveRequest.belongsTo(models.User, { foreignKey: 'userId', as: 'applicant' });
    LeaveRequest.belongsTo(models.LeaveType, { foreignKey: 'leaveTypeId' });
  };

  return LeaveRequest;
};
