module.exports = {
  async up({ queryInterface, transaction }) {
    await queryInterface.addIndex(
      'baidu_tongji_snapshots',
      ['refreshed_at'],
      {
        name: 'baidu_tongji_snapshots_refreshed',
        transaction
      }
    );
    await queryInterface.addIndex(
      'baidu_tongji_source_trend_snapshots',
      ['refreshed_at'],
      {
        name: 'baidu_tongji_source_trends_refreshed',
        transaction
      }
    );
    await queryInterface.addIndex(
      'baidu_tongji_range_snapshots',
      ['refreshed_at'],
      {
        name: 'baidu_tongji_range_snapshots_refreshed',
        transaction
      }
    );
  }
};
