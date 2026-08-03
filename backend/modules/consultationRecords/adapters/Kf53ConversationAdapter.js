class Kf53ConversationAdapter {
  constructor() {
    this.sourceSystem = 'KF53';
    this.consultationType = 'ONLINE_CHAT';
    this.allowedExternalOrigins = [];
  }

  async getStatus() {
    return {
      sourceSystem: this.sourceSystem,
      consultationType: this.consultationType,
      sourceState: 'NOT_CONNECTED',
      recordCoverage: 'NONE',
      reasonCode: 'KF53_API_UNVERIFIED'
    };
  }

  owns(recordId) {
    return String(recordId).startsWith('kf53:');
  }

  async listRecords() {
    return [];
  }

  async getRecord() {
    return null;
  }
}

module.exports = { Kf53ConversationAdapter };
