module.exports = {
  async up({ queryInterface, transaction }) {
    await queryInterface.addIndex(
      'website_form_consultation_snapshots_v2',
      ['refreshed_at'],
      {
        name: 'website_form_consultation_snapshots_v2_refreshed',
        transaction
      }
    );
  }
};
