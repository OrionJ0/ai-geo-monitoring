function closeHttpServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      server.closeAllConnections?.();
      finish();
    }, 12_000);
    timer.unref?.();
    try {
      server.close(finish);
    } catch {
      finish();
    }
  });
}

function createApplicationShutdown({
  getServer,
  schedulerService,
  webPlatformService,
  sequelize
}) {
  let shutdownPromise = null;
  return function shutdown() {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      await closeHttpServer(getServer?.());
      await schedulerService.stop();
      await webPlatformService.shutdown();
      await sequelize.close();
    })();
    return shutdownPromise;
  };
}

module.exports = {
  closeHttpServer,
  createApplicationShutdown
};
