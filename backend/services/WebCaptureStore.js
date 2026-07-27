const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ALLOWED_ARTIFACT_KINDS = new Set(['search_state', 'final_answer']);
const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function storeError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function assertOwner(owner) {
  const recordId = positiveInteger(owner?.record_id);
  const userId = positiveInteger(owner?.user_id);
  if (!recordId || !userId) {
    throw storeError('web_capture_owner_missing', 'Web 证据缺少有效记录归属');
  }
  const projectId = owner?.project_id == null ? null : positiveInteger(owner.project_id);
  if (owner?.project_id != null && !projectId) {
    throw storeError('web_capture_owner_missing', 'Web 证据项目归属无效');
  }
  return { record_id: recordId, user_id: userId, project_id: projectId };
}

function assertPng(buffer) {
  if (
    !Buffer.isBuffer(buffer)
    || buffer.length < PNG_SIGNATURE.length
    || buffer.length > MAX_ARTIFACT_BYTES
    || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    throw storeError('web_artifact_invalid', 'Web 证据必须是有界 PNG 图片');
  }
}

function assertDimensions(metadata) {
  const width = positiveInteger(metadata?.width);
  const height = positiveInteger(metadata?.height);
  if (!width || !height || width > 20_000 || height > 20_000) {
    throw storeError('web_artifact_invalid', 'Web 证据图片尺寸无效');
  }
  return { width, height };
}

class WebCaptureStore {
  constructor({ rootDir }) {
    if (!rootDir) throw storeError('web_runtime_config_invalid', '未配置 Web 证据目录');
    this.rootDir = path.resolve(rootDir);
    this.stagingRoot = path.join(this.rootDir, '.staging');
    this.recordsRoot = path.join(this.rootDir, 'records');
    this.trashRoot = path.join(this.rootDir, '.trash');
  }

  async ensureRoots() {
    await fs.promises.mkdir(this.stagingRoot, { recursive: true, mode: 0o700 });
    await fs.promises.chmod(this.stagingRoot, 0o700);
    await fs.promises.mkdir(this.recordsRoot, { recursive: true, mode: 0o700 });
    await fs.promises.chmod(this.recordsRoot, 0o700);
    await fs.promises.mkdir(this.trashRoot, { recursive: true, mode: 0o700 });
    await fs.promises.chmod(this.trashRoot, 0o700);
  }

  async beginCapture(owner) {
    const normalizedOwner = assertOwner(owner);
    await this.ensureRoots();
    const id = randomUUID();
    const stagingDir = path.join(this.stagingRoot, id);
    await fs.promises.mkdir(stagingDir, { mode: 0o700 });
    return {
      id,
      owner: normalizedOwner,
      stagingDir,
      finalDir: path.join(this.recordsRoot, String(normalizedOwner.record_id)),
      artifacts: {},
      promoted: false
    };
  }

  async writeArtifact(capture, kind, buffer, metadata = {}) {
    if (!capture?.stagingDir || capture.promoted || !ALLOWED_ARTIFACT_KINDS.has(kind)) {
      throw storeError('web_artifact_invalid', 'Web 证据写入上下文无效');
    }
    assertPng(buffer);
    const { width, height } = assertDimensions(metadata);
    const id = randomUUID();
    const filename = `${id}.png`;
    const target = path.join(capture.stagingDir, filename);
    const temporary = path.join(capture.stagingDir, `.${id}.tmp`);
    try {
      await fs.promises.writeFile(temporary, buffer, { mode: 0o600, flag: 'wx' });
      await fs.promises.rename(temporary, target);
      await fs.promises.chmod(target, 0o600);
    } catch (error) {
      await fs.promises.unlink(temporary).catch(() => {});
      throw storeError('web_artifact_write_failed', '无法保存 Web 证据', error);
    }
    const artifact = {
      id,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      mime_type: 'image/png',
      bytes: buffer.length,
      width,
      height
    };
    capture.artifacts[kind] = artifact;
    return artifact;
  }

  async promoteCapture(capture) {
    if (!capture?.stagingDir || capture.promoted) {
      throw storeError('web_artifact_invalid', 'Web 证据提升上下文无效');
    }
    if (!capture.artifacts.search_state || !capture.artifacts.final_answer) {
      throw storeError('web_artifact_incomplete', 'Web 证据不完整');
    }
    try {
      await fs.promises.rename(capture.stagingDir, capture.finalDir);
      capture.promoted = true;
    } catch (error) {
      throw storeError('web_artifact_promote_failed', '无法提交 Web 证据', error);
    }
    return { artifacts: { ...capture.artifacts } };
  }

  async openArtifact(recordId, artifactId) {
    const normalizedRecordId = positiveInteger(recordId);
    const normalizedArtifactId = String(artifactId || '').toLowerCase();
    if (!normalizedRecordId || !UUID_RE.test(normalizedArtifactId)) {
      throw storeError('invalid_web_capture_reference', 'Web 证据引用无效');
    }
    const recordDirectory = path.join(this.recordsRoot, String(normalizedRecordId));
    const artifactPath = path.resolve(recordDirectory, `${normalizedArtifactId}.png`);
    if (!artifactPath.startsWith(`${path.resolve(recordDirectory)}${path.sep}`)) {
      throw storeError('invalid_web_capture_reference', 'Web 证据引用无效');
    }
    let stat;
    try {
      const [recordStat, artifactStat, realRecordsRoot, realRecordDirectory, realArtifactPath] = await Promise.all([
        fs.promises.lstat(recordDirectory),
        fs.promises.lstat(artifactPath),
        fs.promises.realpath(this.recordsRoot),
        fs.promises.realpath(recordDirectory),
        fs.promises.realpath(artifactPath)
      ]);
      if (
        recordStat.isSymbolicLink()
        || !recordStat.isDirectory()
        || artifactStat.isSymbolicLink()
        || !artifactStat.isFile()
        || !realRecordDirectory.startsWith(`${realRecordsRoot}${path.sep}`)
        || !realArtifactPath.startsWith(`${realRecordDirectory}${path.sep}`)
      ) {
        throw storeError('invalid_web_capture_reference', 'Web 证据引用无效');
      }
      stat = artifactStat;
    } catch (error) {
      if (error.code === 'invalid_web_capture_reference') throw error;
      if (error.code === 'ENOENT') {
        throw storeError('web_capture_missing', 'Web 证据文件不存在');
      }
      throw storeError('web_capture_open_failed', '无法读取 Web 证据', error);
    }
    if (!stat.isFile()) throw storeError('web_capture_missing', 'Web 证据文件不存在');
    return {
      stream: fs.createReadStream(artifactPath),
      mimeType: 'image/png',
      bytes: stat.size
    };
  }

  async discardCapture(capture) {
    if (!capture) return;
    const target = capture.promoted ? capture.finalDir : capture.stagingDir;
    if (target) await fs.promises.rm(target, { recursive: true, force: true }).catch(() => {});
  }

  async discardRecord(recordId) {
    const normalizedRecordId = positiveInteger(recordId);
    if (!normalizedRecordId) {
      throw storeError('invalid_web_capture_reference', 'Web 证据记录引用无效');
    }
    await fs.promises.rm(
      path.join(this.recordsRoot, String(normalizedRecordId)),
      { recursive: true, force: true }
    );
  }

  normalizeOperationId(operationId) {
    const normalized = String(operationId || '').toLowerCase();
    if (!UUID_RE.test(normalized)) {
      throw storeError('invalid_web_capture_reference', 'Web 证据删除操作无效');
    }
    return normalized;
  }

  normalizeRecordIds(recordIds) {
    return Array.from(new Set(
      (Array.isArray(recordIds) ? recordIds : [])
        .map(positiveInteger)
        .filter(Boolean)
    )).sort((a, b) => a - b);
  }

  async quarantineRecords(recordIds, operationId) {
    const normalizedOperationId = this.normalizeOperationId(operationId);
    const ids = this.normalizeRecordIds(recordIds);
    await this.ensureRoots();
    const operationDir = path.join(this.trashRoot, normalizedOperationId);
    await fs.promises.mkdir(operationDir, { recursive: true, mode: 0o700 });
    await fs.promises.chmod(operationDir, 0o700);
    const moved = [];
    try {
      for (const recordId of ids) {
        const source = path.join(this.recordsRoot, String(recordId));
        const target = path.join(operationDir, String(recordId));
        try {
          const targetStat = await fs.promises.lstat(target);
          if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) {
            throw storeError('web_capture_quarantine_failed', 'Web 证据隔离目录无效');
          }
          moved.push(recordId);
          continue;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        let sourceStat;
        try {
          sourceStat = await fs.promises.lstat(source);
        } catch (error) {
          if (error.code === 'ENOENT') continue;
          throw error;
        }
        if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
          throw storeError('web_capture_quarantine_failed', 'Web 证据目录无效');
        }
        await fs.promises.rename(source, target);
        moved.push(recordId);
      }
    } catch (error) {
      await this.restoreQuarantine(normalizedOperationId).catch(() => {});
      if (error.code === 'web_capture_quarantine_failed') throw error;
      throw storeError('web_capture_quarantine_failed', '无法隔离待删除 Web 证据', error);
    }
    return {
      operation_id: normalizedOperationId,
      record_ids: moved
    };
  }

  async restoreQuarantine(operationId) {
    const normalizedOperationId = this.normalizeOperationId(operationId);
    const operationDir = path.join(this.trashRoot, normalizedOperationId);
    let entries;
    try {
      entries = await fs.promises.readdir(operationDir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw storeError('web_capture_restore_failed', '无法读取隔离 Web 证据', error);
    }
    await this.ensureRoots();
    for (const entry of entries) {
      const recordId = positiveInteger(entry.name);
      if (!recordId || !entry.isDirectory() || entry.isSymbolicLink()) {
        throw storeError('web_capture_restore_failed', '隔离 Web 证据目录无效');
      }
      const source = path.join(operationDir, entry.name);
      const target = path.join(this.recordsRoot, entry.name);
      try {
        await fs.promises.lstat(target);
        throw storeError('web_capture_restore_failed', 'Web 证据恢复目标已存在');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await fs.promises.rename(source, target);
    }
    await fs.promises.rm(operationDir, { recursive: true, force: true });
    return true;
  }

  async commitQuarantine(operationId) {
    const normalizedOperationId = this.normalizeOperationId(operationId);
    try {
      await fs.promises.rm(
        path.join(this.trashRoot, normalizedOperationId),
        { recursive: true, force: true }
      );
      return true;
    } catch (error) {
      throw storeError(
        'web_capture_cleanup_incomplete',
        'Web 证据物理清理未完成',
        error
      );
    }
  }

  async reconcileTrash({ recordExists } = {}) {
    if (typeof recordExists !== 'function') {
      throw storeError(
        'web_capture_reconcile_failed',
        '恢复隔离 Web 证据需要数据库记录检查器'
      );
    }
    await this.ensureRoots();
    const operations = await fs.promises.readdir(this.trashRoot, { withFileTypes: true });
    let reconciled = 0;
    for (const operation of operations) {
      if (
        !UUID_RE.test(operation.name)
        || !operation.isDirectory()
        || operation.isSymbolicLink()
      ) {
        throw storeError(
          'web_capture_reconcile_failed',
          '隔离 Web 证据操作目录无效'
        );
      }
      const operationDir = path.join(this.trashRoot, operation.name);
      const entries = await fs.promises.readdir(operationDir, { withFileTypes: true });
      const decisions = [];
      for (const entry of entries) {
        const recordId = positiveInteger(entry.name);
        if (!recordId || !entry.isDirectory() || entry.isSymbolicLink()) {
          throw storeError(
            'web_capture_reconcile_failed',
            '隔离 Web 证据记录目录无效'
          );
        }
        decisions.push({
          entry,
          recordId,
          shouldRestore: Boolean(await recordExists(recordId))
        });
      }
      for (const { entry, shouldRestore } of decisions) {
        const source = path.join(operationDir, entry.name);
        if (shouldRestore) {
          const target = path.join(this.recordsRoot, entry.name);
          try {
            await fs.promises.lstat(target);
            throw storeError(
              'web_capture_reconcile_failed',
              'Web 证据恢复目标已存在'
            );
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
          await fs.promises.rename(source, target);
        } else {
          await fs.promises.rm(source, { recursive: true, force: true });
        }
      }
      await fs.promises.rm(operationDir, { recursive: true, force: true });
      reconciled += 1;
    }
    return reconciled;
  }
}

module.exports = {
  WebCaptureStore,
  MAX_ARTIFACT_BYTES,
  assertOwner
};
