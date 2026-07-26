const SchedulerService = require('../../services/SchedulerService');

SchedulerService.refresh = async () => {
  throw new Error('forced scheduler refresh failure');
};
