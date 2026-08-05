const DEFAULT_UNITS = Object.freeze({
  backend: 'ai-geo-backend.service',
  frontend: 'ai-geo-frontend.service',
});

function parseProperties(output) {
  return Object.fromEntries(
    String(output || '')
      .split(/\r?\n/)
      .filter((line) => line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1)];
      })
  );
}

function normalizeStatus(name, unit, properties) {
  const pid = Number(properties.MainPID) || null;
  const verified = properties.LoadState === 'loaded'
    && properties.ActiveState === 'active'
    && properties.SubState === 'running'
    && properties.User === 'ubuntu'
    && Number.isInteger(pid)
    && pid > 0;
  return {
    running: verified,
    pid,
    verified,
    unit,
    loadState: properties.LoadState || 'unknown',
    activeState: properties.ActiveState || 'unknown',
    subState: properties.SubState || 'unknown',
    user: properties.User || '',
  };
}

function createSystemdProcessManager({
  runSystemctl,
  waitForHttp,
  verifyRevision,
  units = DEFAULT_UNITS,
} = {}) {
  if (typeof runSystemctl !== 'function') {
    throw new TypeError('runSystemctl is required');
  }

  async function inspect(name) {
    const unit = units[name];
    const { stdout } = await runSystemctl([
      'show',
      unit,
      '--no-pager',
      '--property=LoadState,ActiveState,SubState,MainPID,User',
    ]);
    return normalizeStatus(name, unit, parseProperties(stdout));
  }

  async function status() {
    const [backend, frontend] = await Promise.all([
      inspect('backend'),
      inspect('frontend'),
    ]);
    return { backend, frontend };
  }

  function requireLoaded(current) {
    for (const [name, service] of Object.entries(current)) {
      if (service.loadState !== 'loaded') {
        throw new Error(`${name} systemd unit 未加载: ${service.unit}`);
      }
    }
  }

  async function start() {
    if (typeof waitForHttp !== 'function') {
      throw new TypeError('waitForHttp is required to start systemd services');
    }
    requireLoaded(await status());
    try {
      await runSystemctl(['start', units.backend], { privileged: true });
      await waitForHttp('http://127.0.0.1:3002/api/ready', '后端');
      await runSystemctl(['start', units.frontend], { privileged: true });
      await waitForHttp('http://127.0.0.1:3001/', '前端');
      await waitForHttp(
        'http://127.0.0.1:3001/api/ready',
        '前端 API 代理'
      );
      if (typeof verifyRevision === 'function') {
        await verifyRevision();
      }

      const current = await status();
      if (!current.backend.running || !current.frontend.running) {
        throw new Error('健康检查通过，但 systemd unit 未处于运行状态');
      }
      return current;
    } catch (error) {
      try {
        await stopUnits();
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `systemd 启动失败且回滚失败: ${error.message}`
        );
      }
      throw error;
    }
  }

  async function stopUnits() {
    const failures = [];
    for (const name of ['frontend', 'backend']) {
      try {
        await runSystemctl(['stop', units[name]], { privileged: true });
      } catch (error) {
        failures.push(error);
      }
    }
    const current = await status();
    for (const name of ['frontend', 'backend']) {
      if (current[name].running) {
        failures.push(new Error(
          `${name} systemd unit 停止后仍在运行: ${current[name].unit}`
        ));
      }
    }
    if (failures.length) {
      const state = ['frontend', 'backend'].map((name) => (
        `${name}=${current[name].activeState}/${current[name].subState}`
        + ` MainPID=${current[name].pid || 0}`
      )).join('；');
      throw new AggregateError(
        failures,
        `systemd 停服未完整成功；${state}`
      );
    }
    return current;
  }

  async function stop() {
    requireLoaded(await status());
    return stopUnits();
  }

  return { start, status, stop };
}

export {
  createSystemdProcessManager,
};
